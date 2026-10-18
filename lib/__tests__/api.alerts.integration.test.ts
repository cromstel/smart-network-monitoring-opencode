/**
 * End-to-end: migrations -> repositories -> route handlers for the alert-rule
 * routes. Three contract points were wrong before this and are pinned here:
 * `threshold` was documented as required for `bandwidth_exceeded` but was never
 * enforced (a rule stored without one could never fire); `DELETE` demanded
 * ADMIN outright although the role table gives MEMBER "manage own alerts"; and
 * `PATCH` did not exist at all. Every write is asserted to be owner-scoped,
 * because `PRD` F-34 exists for a cross-user leak that already happened once.
 */

const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OWNER_SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const RULE_ID = '12121212-1212-4121-8121-121212121212'
const OTHER_RULE_ID = '13131313-1313-4133-8131-131313131313'
const SCOPED_RULE_ID = '15151515-1515-4515-8515-151515151515'
const DEVICE_ID = '16161616-1616-4616-8616-161616161616'
const NOW = '2026-10-01T09:00:00.000Z'

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/services/authService'
import { getAuthContext, requireAuth } from '@/lib/api/auth'

jest.mock('next/headers', () => ({ cookies: jest.fn() }))

jest.mock('@/lib/services/authService', () => ({
  ...jest.requireActual('@/lib/services/authService'),
  validateSession: jest.fn(),
}))

jest.mock('@/lib/api/auth', () => ({
  ...jest.requireActual('@/lib/api/auth'),
  getAuthContext: jest.fn(),
  requireAuth: jest.fn(),
}))

describe('alert rule routes', () => {
  let db: import('kysely').Kysely<import('@/lib/db/schema').DB>
  let requireAuthMock: jest.Mock
  let GET: () => Promise<Response>
  let POST: (req: Request) => Promise<Response>
  let PATCH: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
  let DELETE: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
  /** Role the mocked session carries; individual tests override it. */
  let role: 'VIEWER' | 'MEMBER' | 'ADMIN'

  beforeAll(async () => {
    process.env.DB_FILE = ':memory:'

    const client = await import('@/lib/db/client')
    const { createMigrator } = await import('@/lib/db/migrator')
    db = client.db

    const result = await createMigrator(db).migrateToLatest()
    expect(result.error).toBeUndefined()

    for (const [id, email, r] of [
      [OWNER_ID, 'owner@example.com', 'MEMBER'],
      [OTHER_ID, 'other@example.com', 'MEMBER'],
    ] as const) {
      await db
        .insertInto('users')
        .values({
          id,
          email,
          password_hash: 'hash',
          name: email,
          role: r,
          is_active: 1,
          created_at: NOW,
          updated_at: NOW,
        })
        .execute()
    }

    await db
      .insertInto('sessions')
      .values({
        id: OWNER_SESSION_ID,
        user_id: OWNER_ID,
        token_hash: 'test-hash',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        ip_address: null,
        user_agent: null,
        created_at: NOW,
      })
      .execute()

    await db
      .insertInto('devices')
      .values({
        id: DEVICE_ID,
        mac_address: 'A4:83:E7:2C:11:09',
        ip_address: '192.168.1.42',
        device_type: 'tv',
        status: 'online',
        total_connection_time: 0,
        first_seen: NOW,
        last_seen: NOW,
        created_at: NOW,
        updated_at: NOW,
      })
      .execute()

    const rule = (id: string, userId: string) => ({
      id,
      user_id: userId,
      device_id: null,
      alert_type: 'unknown_device',
      threshold: null,
      is_active: 1,
      last_triggered: null,
      trigger_count: 0,
      created_at: NOW,
      updated_at: NOW,
    })

    await db
      .insertInto('device_alerts')
      .values([
        rule(RULE_ID, OWNER_ID),
        rule(OTHER_RULE_ID, OTHER_ID),
        // Device-scoped: used to prove a partial PATCH cannot widen the scope.
        { ...rule(SCOPED_RULE_ID, OWNER_ID), device_id: DEVICE_ID },
      ])
      .execute()

    const collection = await import('@/app/api/alerts/route')
    const single = await import('@/app/api/alerts/[id]/route')
    GET = collection.GET
    POST = collection.POST
    PATCH = single.PATCH
    DELETE = single.DELETE
  })

  afterAll(async () => {
    await db.destroy()
    delete (globalThis as { __db?: unknown }).__db
    delete process.env.DB_FILE
  })

  beforeEach(() => {
    jest.clearAllMocks()
    role = 'MEMBER'

    requireAuthMock = jest.fn().mockImplementation(() =>
      role === 'VIEWER'
        ? Promise.resolve(
            new NextResponse(JSON.stringify({ error: 'FORBIDDEN' }), { status: 403 })
          )
        : Promise.resolve({
            user: { id: OWNER_ID, role },
            session: {
              user: { id: OWNER_ID, email: 'owner@example.com', name: 'owner', role },
              session: { id: OWNER_SESSION_ID },
            },
          })
    )
    ;(requireAuth as jest.Mock).mockImplementation(requireAuthMock)
    ;(getAuthContext as jest.Mock).mockResolvedValue({
      user: { id: OWNER_ID, role },
      session: null,
    })
    ;(validateSession as jest.Mock).mockResolvedValue(undefined)
    ;(cookies as jest.Mock).mockReturnValue({
      get: jest.fn((name: string) =>
        name === 'session' ? { value: 'test-session-token' } : undefined
      ),
    })
  })

  const jsonRequest = (method: string, body: unknown) =>
    new Request('http://localhost/api/alerts', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

  describe('POST /api/alerts', () => {
    it('rejects a bandwidth rule with no threshold — it could never fire', async () => {
      const res = await POST(
        jsonRequest('POST', { alertType: 'bandwidth_exceeded', deviceId: null })
      )
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('INVALID_BODY')
    })

    it('accepts a bandwidth rule that carries a threshold', async () => {
      const res = await POST(
        jsonRequest('POST', {
          alertType: 'bandwidth_exceeded',
          deviceId: null,
          threshold: 50,
        })
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.data.threshold).toBe(50)
      expect(body.data.isActive).toBe(true)

      await db.deleteFrom('device_alerts').where('id', '=', body.data.id).execute()
    })

    it('rejects a threshold on a rule type that cannot use one', async () => {
      const res = await POST(
        jsonRequest('POST', { alertType: 'unknown_device', threshold: 50 })
      )
      expect(res.status).toBe(400)
    })

    it('takes the owner from the session, ignoring the body', async () => {
      const res = await POST(
        jsonRequest('POST', {
          alertType: 'unknown_device',
          userId: OTHER_ID,
          deviceId: null,
        })
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.data.userId).toBe(OWNER_ID)

      await db.deleteFrom('device_alerts').where('id', '=', body.data.id).execute()
    })

    it('403s a VIEWER', async () => {
      role = 'VIEWER'
      const res = await POST(jsonRequest('POST', { alertType: 'unknown_device' }))
      expect(res.status).toBe(403)
    })
  })

  describe('GET /api/alerts', () => {
    it('returns only the caller rules, never another account (F-34)', async () => {
      const body = await (await GET()).json()
      const ids = body.data.map((r: { id: string }) => r.id)

      expect(ids).toContain(RULE_ID)
      expect(ids).toContain(SCOPED_RULE_ID)
      expect(ids).not.toContain(OTHER_RULE_ID)
      expect(body.data.every((r: { userId: string }) => r.userId === OWNER_ID)).toBe(true)
    })
  })

  describe('PATCH /api/alerts/:id', () => {
    it("updates the caller's own rule", async () => {
      const res = await PATCH(
        jsonRequest('PATCH', { isActive: false, threshold: 100 }),
        ctx(RULE_ID)
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.isActive).toBe(false)
      expect(body.data.threshold).toBe(100)

      await db
        .updateTable('device_alerts')
        .set({ is_active: 1, threshold: null })
        .where('id', '=', RULE_ID)
        .execute()
    })

    it('does not widen the scope of a device-scoped rule on a partial update', async () => {
      // Regression: the handler used to forward every property of the parsed
      // body, including absent ones as `undefined`. `updateAlert` decides what
      // to write with `'deviceId' in patch`, so a PATCH carrying only
      // `isActive` matched that test and nulled `device_id` — quietly turning a
      // per-device rule into a global one that fires on every device.
      const res = await PATCH(jsonRequest('PATCH', { isActive: false }), ctx(SCOPED_RULE_ID))
      expect(res.status).toBe(200)

      const row = await db
        .selectFrom('device_alerts')
        .where('id', '=', SCOPED_RULE_ID)
        .selectAll()
        .executeTakeFirst()

      expect(Number(row?.is_active)).toBe(0)
      expect(row?.device_id).toBe(DEVICE_ID)

      await db
        .updateTable('device_alerts')
        .set({ is_active: 1 })
        .where('id', '=', SCOPED_RULE_ID)
        .execute()
    })

    it('clears the device scope only when deviceId is explicitly sent as null', async () => {
      const res = await PATCH(
        jsonRequest('PATCH', { deviceId: null }),
        ctx(SCOPED_RULE_ID)
      )
      expect(res.status).toBe(200)

      const row = await db
        .selectFrom('device_alerts')
        .where('id', '=', SCOPED_RULE_ID)
        .selectAll()
        .executeTakeFirst()
      expect(row?.device_id).toBeNull()

      // Restore the scope so later tests see the seeded state.
      await db
        .updateTable('device_alerts')
        .set({ device_id: DEVICE_ID })
        .where('id', '=', SCOPED_RULE_ID)
        .execute()
    })

    it('404s another account rule rather than 403', async () => {
      const res = await PATCH(jsonRequest('PATCH', { isActive: false }), ctx(OTHER_RULE_ID))
      expect(res.status).toBe(404)

      const row = await db
        .selectFrom('device_alerts')
        .where('id', '=', OTHER_RULE_ID)
        .selectAll()
        .executeTakeFirst()
      expect(Number(row?.is_active)).toBe(1)
    })

    it('404s an id that does not exist', async () => {
      const res = await PATCH(
        jsonRequest('PATCH', { isActive: false }),
        ctx('99999999-9999-4999-8999-999999999999')
      )
      expect(res.status).toBe(404)
    })

    it('rejects an empty body and malformed JSON', async () => {
      const empty = await PATCH(jsonRequest('PATCH', {}), ctx(RULE_ID))
      expect(empty.status).toBe(400)

      const malformed = await PATCH(
        new Request('http://localhost/api/alerts/x', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: 'not json',
        }),
        ctx(RULE_ID)
      )
      expect(malformed.status).toBe(400)
    })

    it('403s a VIEWER', async () => {
      role = 'VIEWER'
      const res = await PATCH(jsonRequest('PATCH', { isActive: false }), ctx(RULE_ID))
      expect(res.status).toBe(403)
    })
  })

  describe('DELETE /api/alerts/:id', () => {
    // The role list is ADMIN + MEMBER ("owner or ADMIN" in API.md, "manage own
    // alerts" in the role table) while the query stays scoped to the caller.
    it("deletes the caller's own rule as a MEMBER", async () => {
      role = 'MEMBER'
      await db
        .insertInto('device_alerts')
        .values({
          id: '14141414-1414-4144-8414-141414141414',
          user_id: OWNER_ID,
          device_id: null,
          alert_type: 'device_offline',
          threshold: null,
          is_active: 1,
          last_triggered: null,
          trigger_count: 0,
          created_at: NOW,
          updated_at: NOW,
        })
        .execute()

      const res = await DELETE(
        new Request('http://localhost/api/alerts', { method: 'DELETE' }),
        ctx('14141414-1414-4144-8414-141414141414')
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ data: { success: true } })

      const row = await db
        .selectFrom('device_alerts')
        .where('id', '=', '14141414-1414-4144-8414-141414141414')
        .selectAll()
        .executeTakeFirst()
      expect(row).toBeUndefined()
    })

    it("cannot delete another account's rule, ADMIN or not", async () => {
      // Even with an elevated role the handler stays owner-scoped, so a broader
      // role list never becomes a cross-user path.
      role = 'ADMIN'
      const res = await DELETE(
        new Request('http://localhost/api/alerts', { method: 'DELETE' }),
        ctx(OTHER_RULE_ID)
      )
      expect(res.status).toBe(404)

      const row = await db
        .selectFrom('device_alerts')
        .where('id', '=', OTHER_RULE_ID)
        .selectAll()
        .executeTakeFirst()
      expect(row).toBeDefined()
    })

    it('403s a VIEWER', async () => {
      role = 'VIEWER'
      const res = await DELETE(
        new Request('http://localhost/api/alerts', { method: 'DELETE' }),
        ctx(RULE_ID)
      )
      expect(res.status).toBe(403)
    })
  })
})
