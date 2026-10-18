/**
 * Contract for `GET /api/auth/me`: the current user and role, and nothing
 * else. The point of the second assertion is `passwordHash` — the handler
 * receives the full `User` record, so the response has to be built field by
 * field rather than by spreading it (`API.md`: "Returns the user without
 * passwordHash").
 */

import { NextResponse } from 'next/server'
import { getAuthContext, requireAuth } from '@/lib/api/auth'

jest.mock('@/lib/api/auth', () => ({
  ...jest.requireActual('@/lib/api/auth'),
  getAuthContext: jest.fn(),
  requireAuth: jest.fn(),
}))

describe('GET /api/auth/me', () => {
  let GET: () => Promise<Response>
  let requireAuthMock: jest.Mock

  beforeAll(async () => {
    // Set before lib/db/client.ts is evaluated; this route issues no query, so
    // no migrations are needed.
    process.env.DB_FILE = ':memory:'

    const route = await import('@/app/api/auth/me/route')
    GET = route.GET
  })

  afterAll(() => {
    delete process.env.DB_FILE
  })

  beforeEach(() => {
    jest.clearAllMocks()

    requireAuthMock = jest.fn().mockResolvedValue({
      user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'MEMBER' },
      // The full record, exactly as `validateSession` returns it — including
      // the hash that must never cross the wire.
      session: {
        user: {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          email: 'owner@example.com',
          name: 'Owner',
          role: 'MEMBER',
          passwordHash: '$2b$12$super-secret-hash',
          isActive: true,
        },
        session: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      },
    })
    ;(requireAuth as jest.Mock).mockImplementation(requireAuthMock)
    ;(getAuthContext as jest.Mock).mockResolvedValue({
      user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'MEMBER' },
      session: null,
    })
  })

  it('returns exactly the renderable fields of the signed-in user', async () => {
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      data: {
        user: {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          email: 'owner@example.com',
          name: 'Owner',
          role: 'MEMBER',
        },
      },
    })
  })

  it('never leaks the password hash, even though it is on the record', async () => {
    const res = await GET()
    const text = await res.text()

    expect(text).not.toContain('passwordHash')
    expect(text).not.toContain('$2b$12$')
    expect(text).not.toContain('isActive')
  })

  it('is unavailable without a session', async () => {
    requireAuthMock.mockResolvedValue(
      new NextResponse(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 })
    )

    const res = await GET()
    expect(res.status).toBe(401)
  })
})
