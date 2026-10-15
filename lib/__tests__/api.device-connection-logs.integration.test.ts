/**
 * End-to-end: migrations -> repositories -> route handler -> JSON for
 * GET /api/devices/:id/connection-logs. The device page's Connection History
 * card used to be a hardcoded placeholder because no endpoint consumed the
 * existing `connection_logs` table and `listByDevice` repository (found by an
 * admin-session audit, 2026-10-15). These tests pin the contract the UI now
 * depends on: newest first, seconds for `connectionDuration`, string ids, and
 * the same 404/400 behaviour as the sibling bandwidth route.
 */

// Real UUIDs, not readable placeholders: users.id and sessions.id are
// declared `uuid`, and MySQL rejects anything else (see the note in
// api.devices.integration.test.ts).
const TEST_USER_ID = '33333333-3333-4333-8333-333333333333'
const TEST_SESSION_ID = '44444444-4444-4444-8444-444444444444'
const DEVICE_ID = '55555555-5555-4555-8555-555555555555'
const UNKNOWN_DEVICE_ID = '66666666-6666-4666-8666-666666666666'

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
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

describe('GET /api/devices/:id/connection-logs', () => {
  let db: import('kysely').Kysely<import('@/lib/db/schema').DB>
  let GET: (req: import('next/server').NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
  let NextRequest: typeof import('next/server').NextRequest
  let requireAuthMock: jest.Mock

  beforeAll(async () => {
    // Must be set before lib/db/client.ts is evaluated (it reads DB_FILE at import).
    process.env.DB_FILE = ':memory:'

    const { NextRequest: NR } = await import('next/server')
    NextRequest = NR
    const client = await import('@/lib/db/client')
    const { createMigrator } = await import('@/lib/db/migrator')
    db = client.db

    const result = await createMigrator(db).migrateToLatest()
    expect(result.error).toBeUndefined()

    await db
      .insertInto('devices')
      .values({
        id: DEVICE_ID,
        mac_address: 'A4:83:E7:2C:11:09',
        ip_address: '192.168.1.42',
        device_type: 'phone',
        status: 'online',
        total_connection_time: 0,
        first_seen: '2026-08-01T09:12:00.000Z',
        last_seen: '2026-09-24T10:00:00.000Z',
        created_at: '2026-08-01T09:12:00.000Z',
        updated_at: '2026-09-24T10:00:00.000Z',
      })
      .execute()

    await db
      .insertInto('connection_logs')
      .values([
        {
          id: '55555555-5555-4555-8555-555555555501',
          device_id: DEVICE_ID,
          event_type: 'connected',
          timestamp: '2026-09-24T09:00:00.000Z',
          ip_address: '192.168.1.42',
          connection_duration: null,
          created_at: '2026-09-24T09:00:00.000Z',
        },
        {
          id: '55555555-5555-4555-8555-555555555502',
          device_id: DEVICE_ID,
          event_type: 'disconnected',
          timestamp: '2026-09-24T09:45:00.000Z',
          ip_address: '192.168.1.42',
          connection_duration: 2700,
          created_at: '2026-09-24T09:45:00.000Z',
        },
      ])
      .execute()

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

    const route = await import('@/app/api/devices/[id]/connection-logs/route')
    GET = route.GET
  })

  afterAll(async () => {
    await db.destroy()
    delete (globalThis as { __db?: unknown }).__db
    delete process.env.DB_FILE
  })

  beforeEach(() => {
    jest.clearAllMocks()

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
    ;(getAuthContext as jest.Mock).mockResolvedValue({
      user: { id: TEST_USER_ID, role: 'VIEWER' },
      session: null,
    })
    ;(validateSession as jest.Mock).mockResolvedValue(undefined)
    ;(cookies as jest.Mock).mockReturnValue({
      get: jest.fn((name: string) => {
        if (name === 'session') return { value: 'test-session-token' }
        return undefined
      }),
    })
  })

  function request(query = ''): import('next/server').NextRequest {
    return new NextRequest(`http://localhost/api/devices/${DEVICE_ID}/connection-logs${query}`)
  }

  it('returns events newest first with the fields the UI renders', async () => {
    const res = await GET(request(), { params: Promise.resolve({ id: DEVICE_ID }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toHaveLength(2)

    // Newest first: the 09:45 disconnect precedes the 09:00 connect.
    expect(body[0]).toEqual({
      id: '55555555-5555-4555-8555-555555555502',
      eventType: 'disconnected',
      timestamp: '2026-09-24T09:45:00.000Z',
      ipAddress: '192.168.1.42',
      connectionDuration: 2700,
    })
    expect(body[1].eventType).toBe('connected')
    expect(body[1].connectionDuration).toBeNull()
  })

  it('honours the limit parameter', async () => {
    const res = await GET(request('?limit=1'), { params: Promise.resolve({ id: DEVICE_ID }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toHaveLength(1)
    expect(body[0].eventType).toBe('disconnected')
  })

  it('rejects a limit that is not a positive integer of at most 100', async () => {
    const zero = await GET(request('?limit=0'), { params: Promise.resolve({ id: DEVICE_ID }) })
    expect(zero.status).toBe(400)

    const text = await GET(request('?limit=abc'), { params: Promise.resolve({ id: DEVICE_ID }) })
    expect(text.status).toBe(400)

    const huge = await GET(request('?limit=101'), { params: Promise.resolve({ id: DEVICE_ID }) })
    expect(huge.status).toBe(400)
  })

  it('404s for an unknown device', async () => {
    const res = await GET(request(), { params: Promise.resolve({ id: UNKNOWN_DEVICE_ID }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('NOT_FOUND')
  })

  it('requires authentication', async () => {
    requireAuthMock.mockResolvedValue(
      new NextResponse(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 })
    )

    const res = await GET(request(), { params: Promise.resolve({ id: DEVICE_ID }) })
    expect(res.status).toBe(401)
  })
})
