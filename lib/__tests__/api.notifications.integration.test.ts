/**
 * End-to-end: migrations -> repositories -> route handlers for the three
 * notification routes. `GET /api/notifications` previously returned neither
 * `unreadCount` nor any query filter, `PATCH /api/notifications/:id` did not
 * exist (the collection route took the id in the body instead), and
 * `POST /api/notifications/read-all` was missing entirely — all three are
 * specified in `API.md`. These tests pin the contract the Alerts page depends
 * on, including the owner-scoping that `PRD` F-34 requires.
 */

const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OWNER_SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NOTIFICATION_ONE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const NOTIFICATION_TWO = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const NOTIFICATION_OTHER = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const DEVICE_ID = '11111111-1111-4111-8111-111111111111'
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

describe('notification routes', () => {
  let db: import('kysely').Kysely<import('@/lib/db/schema').DB>
  let requireAuthMock: jest.Mock
  let GET: (req: Request) => Promise<Response>
  let PATCH: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
  let POST: () => Promise<Response>

  beforeAll(async () => {
    process.env.DB_FILE = ':memory:'

    const client = await import('@/lib/db/client')
    const { createMigrator } = await import('@/lib/db/migrator')
    db = client.db

    const result = await createMigrator(db).migrateToLatest()
    expect(result.error).toBeUndefined()

    const now = NOW
    for (const [id, email, role] of [
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
          role,
          is_active: 1,
          created_at: now,
          updated_at: now,
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
        created_at: now,
      })
      .execute()

    await db
      .insertInto('devices')
      .values({
        id: DEVICE_ID,
        mac_address: 'A4:83:E7:2C:11:09',
        ip_address: '192.168.1.42',
        device_name: "Ana's iPhone",
        device_type: 'phone',
        status: 'online',
        total_connection_time: 0,
        first_seen: now,
        last_seen: now,
        created_at: now,
        updated_at: now,
      })
      .execute()

    const notification = (id: string, userId: string, isRead: number, type: string) => ({
      id,
      user_id: userId,
      device_id: DEVICE_ID,
      alert_id: null,
      title: `title-${id.slice(-1)}`,
      message: 'message',
      type,
      priority: 'high',
      is_read: isRead,
      read_at: isRead ? now : null,
      data: null,
      created_at: now,
    })

    await db
      .insertInto('notifications')
      .values([
        // Owner: one unread unknown_device, one read unknown_device.
        notification(NOTIFICATION_ONE, OWNER_ID, 0, 'unknown_device'),
        notification(NOTIFICATION_TWO, OWNER_ID, 1, 'device_offline'),
        // Another account's notification — must never be visible or mutable.
        notification(NOTIFICATION_OTHER, OTHER_ID, 0, 'unknown_device'),
      ])
      .execute()

    const { GET: g } = await import('@/app/api/notifications/route')
    const { PATCH: p } = await import('@/app/api/notifications/[id]/route')
    const { POST: po } = await import('@/app/api/notifications/read-all/route')
    GET = g
    PATCH = p
    POST = po
  })

  afterAll(async () => {
    await db.destroy()
    delete (globalThis as { __db?: unknown }).__db
    delete process.env.DB_FILE
  })

  beforeEach(() => {
    jest.clearAllMocks()

    requireAuthMock = jest.fn().mockResolvedValue({
      user: { id: OWNER_ID, role: 'MEMBER' },
      session: {
        user: {
          id: OWNER_ID,
          email: 'owner@example.com',
          name: 'owner',
          role: 'MEMBER',
        },
        session: { id: OWNER_SESSION_ID },
      },
    })
    ;(requireAuth as jest.Mock).mockImplementation(requireAuthMock)
    ;(getAuthContext as jest.Mock).mockResolvedValue({
      user: { id: OWNER_ID, role: 'MEMBER' },
      session: null,
    })
    ;(validateSession as jest.Mock).mockResolvedValue(undefined)
    ;(cookies as jest.Mock).mockReturnValue({
      get: jest.fn((name: string) =>
        name === 'session' ? { value: 'test-session-token' } : undefined
      ),
    })

    // Canonical state before every test: the caller has exactly one unread and
    // one read notification, and the other account has one unread. Without this
    // a test would inherit whatever a previous one wrote — the read-all and
    // unreadCount assertions would otherwise depend on declaration order.
    return db
      .updateTable('notifications')
      .set({ is_read: 0, read_at: null })
      .where('id', '=', NOTIFICATION_ONE)
      .execute()
      .then(() =>
        db
          .updateTable('notifications')
          .set({ is_read: 1, read_at: NOW })
          .where('id', '=', NOTIFICATION_TWO)
          .execute()
      )
      .then(() =>
        db
          .updateTable('notifications')
          .set({ is_read: 0, read_at: null })
          .where('id', '=', NOTIFICATION_OTHER)
          .execute()
      )
  })

  const jsonRequest = (method: string, body: unknown) =>
    new Request('http://localhost/api/notifications', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  describe('GET /api/notifications', () => {
    it('returns unreadCount, the notifications and the device options', async () => {
      const res = await GET(new Request('http://localhost/api/notifications'))
      const body = await res.json()

      expect(res.status).toBe(200)
      // The other account's notification is excluded (F-34): only the two
      // belonging to the caller are in scope.
      expect(body.data.notifications).toHaveLength(2)
      // Counted across everything the caller owns, not the returned page.
      expect(body.data.unreadCount).toBe(1)
      expect(body.data.devices).toEqual([
        { id: DEVICE_ID, name: "Ana's iPhone", macAddress: 'A4:83:E7:2C:11:09' },
      ])
      // Never leaks the other account's notification by id either.
      expect(
        body.data.notifications.map((n: { id: string }) => n.id)
      ).not.toContain(NOTIFICATION_OTHER)
    })

    it('filters to unread with isRead=false and to read with isRead=true', async () => {
      const unread = await (
        await GET(new Request('http://localhost/api/notifications?isRead=false'))
      ).json()
      expect(unread.data.notifications).toHaveLength(1)
      expect(unread.data.notifications[0].isRead).toBe(false)

      const read = await (
        await GET(new Request('http://localhost/api/notifications?isRead=true'))
      ).json()
      expect(read.data.notifications).toHaveLength(1)
      expect(read.data.notifications[0].isRead).toBe(true)
    })

    it('filters by type', async () => {
      const body = await (
        await GET(new Request('http://localhost/api/notifications?type=device_offline'))
      ).json()
      expect(body.data.notifications).toHaveLength(1)
      expect(body.data.notifications[0].type).toBe('device_offline')
    })

    it('clamps pageSize into the documented 1–100 range', async () => {
      // 0 is below the range and clamps to the minimum, not to the default.
      const zero = await (
        await GET(new Request('http://localhost/api/notifications?pageSize=0'))
      ).json()
      expect(zero.data.notifications).toHaveLength(1)

      const one = await (
        await GET(new Request('http://localhost/api/notifications?pageSize=1'))
      ).json()
      expect(one.data.notifications).toHaveLength(1)

      // Above the range it clamps to 100; only two rows exist here, so the
      // ceiling is visible as "everything" rather than as a truncation.
      const huge = await (
        await GET(new Request('http://localhost/api/notifications?pageSize=9999'))
      ).json()
      expect(huge.data.notifications).toHaveLength(2)

      // Not a number at all falls back to the default rather than throwing.
      const nonNumeric = await (
        await GET(new Request('http://localhost/api/notifications?pageSize=abc'))
      ).json()
      expect(nonNumeric.data.notifications).toHaveLength(2)
    })
  })

  describe('PATCH /api/notifications/:id', () => {
    it("marks the caller's own notification read", async () => {
      const res = await PATCH(
        jsonRequest('PATCH', { isRead: true }),
        { params: Promise.resolve({ id: NOTIFICATION_ONE }) }
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ data: { success: true } })

      const row = await db
        .selectFrom('notifications')
        .where('id', '=', NOTIFICATION_ONE)
        .selectAll()
        .executeTakeFirst()
      expect(Number(row?.is_read)).toBe(1)
      expect(row?.read_at).toBeTruthy()
    })

    it('404s for a notification owned by someone else, not 403', async () => {
      const res = await PATCH(
        jsonRequest('PATCH', { isRead: true }),
        { params: Promise.resolve({ id: NOTIFICATION_OTHER }) }
      )

      expect(res.status).toBe(404)
      expect((await res.json()).error).toBe('NOT_FOUND')

      // And the row itself is untouched — the 404 is not merely cosmetic.
      const row = await db
        .selectFrom('notifications')
        .where('id', '=', NOTIFICATION_OTHER)
        .selectAll()
        .executeTakeFirst()
      expect(Number(row?.is_read)).toBe(0)
    })

    it('404s for an id that does not exist', async () => {
      const res = await PATCH(
        jsonRequest('PATCH', { isRead: true }),
        { params: Promise.resolve({ id: '99999999-9999-4999-8999-999999999999' }) }
      )
      expect(res.status).toBe(404)
    })

    it('rejects a body that is not isRead:true', async () => {
      const wrongValue = await PATCH(
        jsonRequest('PATCH', { isRead: false }),
        { params: Promise.resolve({ id: NOTIFICATION_TWO }) }
      )
      expect(wrongValue.status).toBe(400)

      const missing = await PATCH(
        jsonRequest('PATCH', {}),
        { params: Promise.resolve({ id: NOTIFICATION_TWO }) }
      )
      expect(missing.status).toBe(400)

      const malformed = await PATCH(
        new Request('http://localhost/api/notifications/x', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: 'not json',
        }),
        { params: Promise.resolve({ id: NOTIFICATION_TWO }) }
      )
      expect(malformed.status).toBe(400)
    })

    it('requires authentication', async () => {
      requireAuthMock.mockResolvedValue(
        new NextResponse(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 })
      )

      const res = await PATCH(
        jsonRequest('PATCH', { isRead: true }),
        { params: Promise.resolve({ id: NOTIFICATION_ONE }) }
      )
      expect(res.status).toBe(401)
    })
  })

  describe('POST /api/notifications/read-all', () => {
    it("marks only the caller's unread notifications, counting what changed", async () => {
      const before = await db
        .selectFrom('notifications')
        .selectAll()
        .execute()
      expect(before).toHaveLength(3)

      const res = await POST()
      const body = await res.json()

      expect(res.status).toBe(200)
      // Only the caller's one unread row flips: the caller's read row and the
      // other account's unread row are both left alone.
      expect(body.data.updated).toBe(1)

      const owner = await db
        .selectFrom('notifications')
        .where('user_id', '=', OWNER_ID)
        .selectAll()
        .execute()
      expect(owner.every((row) => Number(row.is_read) === 1)).toBe(true)

      const other = await db
        .selectFrom('notifications')
        .where('user_id', '=', OTHER_ID)
        .selectAll()
        .execute()
      expect(Number(other[0]?.is_read)).toBe(0)
    })

    it('is idempotent — a second run reports nothing changed', async () => {
      await POST()
      const res = await POST()
      const body = await res.json()
      expect(body.data.updated).toBe(0)
    })

    it('requires authentication', async () => {
      requireAuthMock.mockResolvedValue(
        new NextResponse(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 })
      )
      expect((await POST()).status).toBe(401)
    })
  })
})
