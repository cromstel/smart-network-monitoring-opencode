/**
 * End-to-end: migrations -> repositories -> route handler for
 * `PATCH /api/devices/:id`. Two contract points are pinned here.
 *
 * 1. The documented body promises `categoryId` and `isIgnored`; the route's
 *    hand-rolled allowlist rejected both even though the repository's
 *    `DevicePatch` accepts them. (`DeviceDTO` still exposes neither, so the
 *    tests below assert against the row rather than the response.)
 * 2. `deviceRepository.update()` decides what to write with `'key' in patch`,
 *    so a key forwarded as `undefined` matches that test and writes `null`.
 *    The handler was already key-by-key for `deviceName`/`deviceType`; the
 *    first test proves the two newly accepted fields follow the same pattern,
 *    because the failure mode is silent — a rename would quietly drop a
 *    category without erroring.
 */

const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OWNER_SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const DEVICE_ID = '11111111-1111-4111-8111-111111111111'
const CATEGORY_ID = '21212121-2121-4121-8121-212121212121'
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

describe('PATCH /api/devices/:id', () => {
  let db: import('kysely').Kysely<import('@/lib/db/schema').DB>
  let requireAuthMock: jest.Mock
  let PATCH: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
  let role: 'VIEWER' | 'MEMBER' | 'ADMIN'

  beforeAll(async () => {
    process.env.DB_FILE = ':memory:'

    const client = await import('@/lib/db/client')
    const { createMigrator } = await import('@/lib/db/migrator')
    db = client.db

    const result = await createMigrator(db).migrateToLatest()
    expect(result.error).toBeUndefined()

    await db
      .insertInto('users')
      .values({
        id: OWNER_ID,
        email: 'owner@example.com',
        password_hash: 'hash',
        name: 'Owner',
        role: 'MEMBER',
        is_active: 1,
        created_at: NOW,
        updated_at: NOW,
      })
      .execute()

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
      .insertInto('device_categories')
      .values({
        id: CATEGORY_ID,
        name: 'Media',
        color: '#3b82f6',
        icon: null,
        description: null,
        created_at: NOW,
        updated_at: NOW,
      })
      .execute()

    await db
      .insertInto('devices')
      .values({
        id: DEVICE_ID,
        mac_address: 'A4:83:E7:2C:11:09',
        ip_address: '192.168.1.42',
        device_name: 'Living Room TV',
        device_type: 'tv',
        category_id: null,
        is_ignored: 0,
        status: 'online',
        total_connection_time: 0,
        first_seen: NOW,
        last_seen: NOW,
        created_at: NOW,
        updated_at: NOW,
      })
      .execute()

    const route = await import('@/app/api/devices/[id]/route')
    PATCH = route.PATCH
  })

  afterAll(async () => {
    await db.destroy()
    delete (globalThis as { __db?: unknown }).__db
    delete process.env.DB_FILE
  })

  beforeEach(() => {
    jest.clearAllMocks()
    role = 'ADMIN'

    requireAuthMock = jest.fn().mockImplementation(() =>
      role === 'VIEWER'
        ? Promise.resolve(
            new NextResponse(JSON.stringify({ error: 'FORBIDDEN' }), { status: 403 })
          )
        : Promise.resolve({
            user: { id: OWNER_ID, role },
            session: {
              user: { id: OWNER_ID, email: 'owner@example.com', name: 'Owner', role },
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

    // Canonical device state before every test.
    return db
      .updateTable('devices')
      .set({ device_name: 'Living Room TV', device_type: 'tv', category_id: null, is_ignored: 0 })
      .where('id', '=', DEVICE_ID)
      .execute()
  })

  const patch = (body: unknown) =>
    new Request(`http://localhost/api/devices/${DEVICE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

  /**
   * Read the row directly. `DeviceDTO` deliberately does not expose
   * `categoryId` or `isIgnored` (`API.md` device example lists neither), so the
   * response body cannot show whether a patch persisted — the database can.
   */
  const readDevice = async () => {
    const row = await db
      .selectFrom('devices')
      .where('id', '=', DEVICE_ID)
      .selectAll()
      .executeTakeFirst()
    return {
      deviceName: row?.device_name,
      categoryId: row?.category_id,
      isIgnored: Number(row?.is_ignored) === 1,
    }
  }

  it("renames without touching fields the caller did not send", async () => {
    // Give the device a category first, so "untouched" has something to lose.
    const catRes = await PATCH(patch({ categoryId: CATEGORY_ID }), ctx(DEVICE_ID))
    expect(catRes.status).toBe(200)

    const res = await PATCH(patch({ deviceName: 'Den TV' }), ctx(DEVICE_ID))
    expect(res.status).toBe(200)
    expect((await res.json()).data.deviceName).toBe('Den TV')

    // Guard: `'category_id' in patch` in the repository means an
    // absent-but-undefined field would be written as null here.
    const row = await readDevice()
    expect(row.deviceName).toBe('Den TV')
    expect(row.categoryId).toBe(CATEGORY_ID)
    expect(row.isIgnored).toBe(false)
  })

  it('sets and clears isIgnored, the supported way to hide a device', async () => {
    const set = await PATCH(patch({ isIgnored: true }), ctx(DEVICE_ID))
    expect(set.status).toBe(200)
    expect((await readDevice()).isIgnored).toBe(true)

    const clear = await PATCH(patch({ isIgnored: false }), ctx(DEVICE_ID))
    expect(clear.status).toBe(200)
    expect((await readDevice()).isIgnored).toBe(false)
  })

  it('accepts and clears categoryId', async () => {
    const set = await PATCH(patch({ categoryId: CATEGORY_ID }), ctx(DEVICE_ID))
    expect(set.status).toBe(200)
    expect((await readDevice()).categoryId).toBe(CATEGORY_ID)

    const clear = await PATCH(patch({ categoryId: null }), ctx(DEVICE_ID))
    expect(clear.status).toBe(200)
    expect((await readDevice()).categoryId).toBeNull()
  })

  it('rejects a categoryId that does not exist', async () => {
    const res = await PATCH(
      patch({ categoryId: '99999999-9999-4999-8999-999999999999' }),
      ctx(DEVICE_ID)
    )
    // Checked before the write: otherwise `fk_devices_category` throws out of
    // the handler and the request becomes an unhandled 500.
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('INVALID_BODY')

    const row = await db
      .selectFrom('devices')
      .where('id', '=', DEVICE_ID)
      .selectAll()
      .executeTakeFirst()
    expect(row?.category_id).toBeNull()
  })

  it('ignores immutable fields rather than honouring them', async () => {
    // `status`, `macAddress` and `ipAddress` are not in the schema, so a body
    // carrying only them has nothing to update and is a 400 — not a 200 that
    // quietly left the device unchanged.
    const res = await PATCH(patch({ status: 'offline', macAddress: 'AA:BB:CC:DD:EE:FF' }), ctx(DEVICE_ID))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('INVALID_BODY')

    const row = await db
      .selectFrom('devices')
      .where('id', '=', DEVICE_ID)
      .selectAll()
      .executeTakeFirst()
    expect(row?.status).toBe('online')
    expect(row?.mac_address).toBe('A4:83:E7:2C:11:09')
  })

  it('rejects an empty body and malformed JSON', async () => {
    const empty = await PATCH(patch({}), ctx(DEVICE_ID))
    expect(empty.status).toBe(400)

    const malformed = await PATCH(
      new Request(`http://localhost/api/devices/${DEVICE_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }),
      ctx(DEVICE_ID)
    )
    expect(malformed.status).toBe(400)
  })

  it('rejects a device type outside the allowlist', async () => {
    const res = await PATCH(patch({ deviceType: 'toaster' }), ctx(DEVICE_ID))
    expect(res.status).toBe(400)
  })

  it('404s an unknown device', async () => {
    const res = await PATCH(patch({ deviceName: 'x' }), ctx('99999999-9999-4999-8999-999999999999'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('NOT_FOUND')
  })

  it('403s a VIEWER', async () => {
    role = 'VIEWER'
    const res = await PATCH(patch({ deviceName: 'x' }), ctx(DEVICE_ID))
    expect(res.status).toBe(403)
  })
})
