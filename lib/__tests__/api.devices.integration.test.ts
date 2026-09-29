/**
 * End-to-end: migrations -> repositories -> service -> route handler -> JSON.
 * Covers AUDIT.md A-05: a byte counter above Number.MAX_SAFE_INTEGER must
 * reach the wire as an exact string, not a rounded number.
 *
 * The user and session ids below are real UUIDs, not readable placeholders like
 * "test-user". `users.id` and `sessions.id` are declared `uuid`, and MySQL
 * enforces that: it rejects the placeholder outright with "Incorrect uuid
 * value", while SQLite stores any text in the same column. The readable ids were
 * why this suite passed on SQLite and failed on MySQL for reasons that had
 * nothing to do with what it is testing.
 */

const TEST_USER_ID = '11111111-1111-4111-8111-111111111111'
const TEST_SESSION_ID = '22222222-2222-4222-8222-222222222222'

import { cookies } from 'next/headers'
import { validateSession } from '@/lib/services/authService'
import { getAuthContext, requireAuth } from '@/lib/api/auth'

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}))

jest.mock('@/lib/services/authService', () => ({
  ...jest.requireActual('@/lib/services/authService'),
  validateSession: jest.fn(),
}))

jest.mock('@/lib/api/auth', () => ({
  ...jest.requireActual('@/lib/api/auth'),
  getAuthContext: jest.fn(),
  requireAuth: jest.fn(),
}))

const DEVICE_ID = '00000000-0000-4000-8000-000000000001'
// Fits SQLite's signed 64-bit INTEGER (exact on both dialects) yet exceeds
// Number.MAX_SAFE_INTEGER — the A-05 case.
const HUGE_UPLOAD = '4611686018427387904' // 2^62
const HUGE_DOWNLOAD = '9007199254740993' // 2^53 + 1

describe('GET /api/devices — BigInt serialisation', () => {
  let db: import('kysely').Kysely<import('@/lib/db/schema').DB>
  let GET: (req: import('next/server').NextRequest) => Promise<Response>
  let NextRequest: typeof import('next/server').NextRequest
  let validateSessionMock: jest.Mock
  let getAuthContextMock: jest.Mock
  let requireAuthMock: jest.Mock

  beforeAll(async () => {
    // Must be set before lib/db/client.ts is evaluated (it reads DB_FILE at import).
    process.env.DB_FILE = ':memory:'

    const { NextRequest: NR } = await import('next/server')
    NextRequest = NR
    const client = await import('@/lib/db/client')
    const { createMigrator } = await import('@/lib/db/migrator')
    const { db: sharedDb } = client
    db = sharedDb

    const result = await createMigrator(db).migrateToLatest()
    expect(result.error).toBeUndefined()

    // Clear anything a previous suite left behind. On SQLite each test file
    // gets its own :memory: database and this is a no-op; against MySQL the
    // whole run shares one database, so without this the device count below
    // picks up rows from other suites and fails for reasons unrelated to what
    // it is asserting. Deletion order respects the foreign keys.
    for (const table of [
      'connection_logs',
      'bandwidth_hourly',
      'bandwidth_metrics',
      'devices',
    ] as const) {
      await db.deleteFrom(table).execute()
    }

    await db
      .insertInto('devices')
      .values({
        id: DEVICE_ID,
        mac_address: 'A4:83:E7:2C:11:09',
        ip_address: '192.168.1.42',
        device_type: 'phone',
        status: 'online',
        total_connection_time: 1840233,
        first_seen: '2026-08-01T09:12:00.000Z',
        last_seen: '2026-09-24T10:00:00.000Z',
        created_at: '2026-08-01T09:12:00.000Z',
        updated_at: '2026-09-24T10:00:00.000Z',
      })
      .execute()

    // Old sample: the stats query must pick the latest by timestamp.
    await db
      .insertInto('bandwidth_metrics')
      .values({
        id: '00000000-0000-4000-8000-000000000002',
        device_id: DEVICE_ID,
        timestamp: '2026-09-24T09:00:00.000Z',
        upload_speed: 0.4,
        download_speed: 8.1,
        upload_total: '1000',
        download_total: '2000',
        created_at: '2026-09-24T09:00:00.000Z',
      })
      .execute()

    // Latest sample with >2^53 byte counters.
    await db
      .insertInto('bandwidth_metrics')
      .values({
        id: '00000000-0000-4000-8000-000000000003',
        device_id: DEVICE_ID,
        timestamp: '2026-09-24T10:00:00.000Z',
        upload_speed: 0.8,
        download_speed: 12.4,
        upload_total: HUGE_UPLOAD,
        download_total: HUGE_DOWNLOAD,
        created_at: '2026-09-24T10:00:00.000Z',
      })
      .execute()

    // Create a test user session
    await db
      .insertInto('users')
      .values({
        id: TEST_USER_ID,
        email: 'test@example.com',
        password_hash: 'hash',
        name: 'Test User',
        role: 'VIEWER',
        is_active: 1,
        created_at: '2026-08-01T09:12:00.000Z',
        updated_at: '2026-08-01T09:12:00.000Z',
      })
      .execute()

    // Insert session with a known hash
    await db
      .insertInto('sessions')
      .values({
        id: TEST_SESSION_ID,
        user_id: TEST_USER_ID,
        token_hash: 'test-hash',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        ip_address: null,
        user_agent: null,
        created_at: new Date().toISOString(),
      })
      .execute()

    const route = await import('@/app/api/devices/route')
    GET = route.GET
  })

  afterAll(async () => {
    await db.destroy()
    delete (globalThis as { __db?: unknown }).__db
    delete process.env.DB_FILE
  })

  beforeEach(() => {
    jest.clearAllMocks()
    validateSessionMock = jest.fn().mockResolvedValue({
      user: {
        id: TEST_USER_ID,
        email: 'test@example.com',
        name: 'Test User',
        role: 'VIEWER',
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      session: {
        id: TEST_SESSION_ID,
        userId: TEST_USER_ID,
        tokenHash: 'test-hash',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: null,
        userAgent: null,
        createdAt: new Date(),
      },
    })
    ;(validateSession as jest.Mock).mockImplementation(validateSessionMock)

    getAuthContextMock = jest.fn().mockResolvedValue({
      user: { id: TEST_USER_ID, role: 'VIEWER' },
      session: {
        id: TEST_SESSION_ID,
        userId: TEST_USER_ID,
        tokenHash: 'test-hash',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: null,
        userAgent: null,
        createdAt: new Date(),
      },
    })
    ;(getAuthContext as jest.Mock).mockImplementation(getAuthContextMock)

    requireAuthMock = jest.fn().mockResolvedValue({
      user: { id: TEST_USER_ID, role: 'VIEWER' },
      session: {
        id: TEST_SESSION_ID,
        userId: TEST_USER_ID,
        tokenHash: 'test-hash',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: null,
        userAgent: null,
        createdAt: new Date(),
      },
    })
    ;(requireAuth as jest.Mock).mockImplementation(requireAuthMock)

    ;(cookies as jest.Mock).mockReturnValue({
      get: jest.fn((name: string) => {
        if (name === 'session') return { value: 'test-session-token' }
        return undefined
      }),
    })
  })

  it('returns byte counters as exact strings above Number.MAX_SAFE_INTEGER', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/devices')
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.pagination.total).toBe(1)
    expect(body.data).toHaveLength(1)

    const dto = body.data[0]
    expect(dto.totalTransferred.uploadBytes).toBe(HUGE_UPLOAD)
    expect(dto.totalTransferred.downloadBytes).toBe(HUGE_DOWNLOAD)
    expect(dto.currentBandwidth).toEqual({ uploadMbps: 0.8, downloadMbps: 12.4 })

    // The raw wire output must carry the full precision — proof nothing coerced it.
    const raw = JSON.stringify(body)
    expect(raw).toContain(`"uploadBytes":"${HUGE_UPLOAD}"`)
    expect(raw).not.toContain(',5e+21')
  })
})