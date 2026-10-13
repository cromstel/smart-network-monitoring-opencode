import { GET, POST } from '@/app/api/router-config/route'
import { db } from '@/lib/db/client'
import { createMigrator } from '@/lib/db/migrator'
import { decrypt } from '@/lib/utils/encryption'
import { asusScanner, invalidateConfigCache } from '@/lib/services/scanners/asusScanner'

/**
 * F-40: the router credential write path. Before this route existed
 * `upsertRouterConfig()` had zero callers, so `SCANNER_MODE=asus` could never
 * activate and `encrypt()` had no production caller either.
 *
 * The two properties worth proving here are the ones a code review cannot:
 *   1. what lands in the row is ciphertext, not the password;
 *   2. the row actually round-trips — asusScanner decrypts it back into the
 *      Authorization header of the request it sends.
 */

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}))

jest.mock('@/lib/services/authService', () => ({
  validateSession: jest.fn(),
  // Mirrors the real gate (lib/services/authService.ts): wrong role throws.
  requireRole: jest.fn((user: { role: string }, ...allowed: string[]) => {
    if (!allowed.includes(user.role)) throw new Error('FORBIDDEN')
  }),
}))

jest.mock('@/lib/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { cookies } from 'next/headers'
import { validateSession } from '@/lib/services/authService'

const mockedCookies = cookies as unknown as jest.Mock
const mockedValidateSession = validateSession as unknown as jest.Mock

const PASSWORD = 'correct-horse-battery-staple'
const BASE = 'http://localhost/api/router-config'

function authorise(role: 'ADMIN' | 'MEMBER' | 'VIEWER'): void {
  mockedCookies.mockResolvedValue({
    get: (name: string) => (name === 'session' ? { value: 'tok' } : undefined),
  })
  mockedValidateSession.mockResolvedValue({
    user: { id: 'user-1', email: 'admin@example.com', role },
    session: { id: 'sess-1', userId: 'user-1' },
  })
}

function postRequest(body: unknown): Request {
  return new Request(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const VALID_BODY = {
  routerType: 'asus',
  routerName: 'Lab router',
  routerIp: '192.168.1.1',
  port: 8443,
  username: 'admin',
  password: PASSWORD,
}

describe('router-config route', () => {
  let fetchSpy: jest.SpyInstance

  beforeAll(async () => {
    const result = await createMigrator(db).migrateToLatest()
    if (result.error) throw result.error
  })

  beforeEach(async () => {
    await db.deleteFrom('router_config').execute()
    authorise('ADMIN')
    asusScanner._cachedAvailable = undefined
    invalidateConfigCache()
    fetchSpy = jest.spyOn(globalThis, 'fetch')
  })

  afterEach(async () => {
    fetchSpy.mockRestore()
    await db.deleteFrom('router_config').execute()
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await db.destroy()
    delete (globalThis as { __db?: unknown }).__db
  })

  describe('POST', () => {
    it('rejects an unauthenticated request', async () => {
      mockedCookies.mockResolvedValue({ get: () => undefined })
      const res = await POST(postRequest(VALID_BODY))
      expect(res.status).toBe(401)
    })

    it('rejects a non-admin session', async () => {
      authorise('VIEWER')
      const res = await POST(postRequest(VALID_BODY))
      expect(res.status).toBe(403)
    })

    it('rejects a malformed body without writing a row', async () => {
      const res = await POST(postRequest({ ...VALID_BODY, routerIp: 'not-an-ip' }))
      expect(res.status).toBe(400)

      const rows = await db.selectFrom('router_config').selectAll().execute()
      expect(rows).toHaveLength(0)
    })

    it('stores the password as ciphertext, never as plaintext', async () => {
      const res = await POST(postRequest(VALID_BODY))
      expect(res.status).toBe(200)

      const rows = await db.selectFrom('router_config').selectAll().execute()
      expect(rows).toHaveLength(1)

      const stored = rows[0].password_encrypted
      expect(stored).not.toBe(PASSWORD)
      expect(stored).not.toContain(PASSWORD)
      // Wire format from lib/utils/encryption.ts: iv:authTag:ciphertext.
      expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/)
      // Round-trips with the production key, so the row is usable ciphertext.
      expect(decrypt(stored)).toBe(PASSWORD)

      // The saved fields must survive the trip (a camelCase/snake_case slip
      // here once inserted generic/0.0.0.0 while reporting success).
      // Number() because raw SQLite rows surface integers as BigInt while
      // MySQL returns numbers — the same assertion has to hold on both legs.
      expect(rows[0].router_type).toBe('asus')
      expect(rows[0].router_ip).toBe('192.168.1.1')
      expect(Number(rows[0].port)).toBe(8443)
      expect(rows[0].username).toBe('admin')
      expect(Number(rows[0].is_connected)).toBe(1)
    })

    it('does not echo the stored credential back to the client', async () => {
      const res = await POST(postRequest(VALID_BODY))
      const body = (await res.json()) as Record<string, unknown>

      expect(body.data).toBeTruthy()
      expect(JSON.stringify(body)).not.toContain(PASSWORD)
      expect((body.data as Record<string, unknown>).passwordEncrypted).toBeUndefined()
    })

    it('updates the active config instead of inserting a second one', async () => {
      const first = (await (await POST(postRequest(VALID_BODY))).json()).data as { id: string }
      const res = await POST(postRequest({ ...VALID_BODY, routerIp: '192.168.1.50' }))
      expect(res.status).toBe(200)

      const rows = await db.selectFrom('router_config').selectAll().execute()
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(first.id)
      expect(rows[0].router_ip).toBe('192.168.1.50')
    })
  })

  describe('GET', () => {
    it('returns the configured router without the credential', async () => {
      await POST(postRequest(VALID_BODY))

      const res = await GET()
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: Record<string, unknown> | null }

      expect(body.data).not.toBeNull()
      expect(body.data?.routerIp).toBe('192.168.1.1')
      expect(body.data?.passwordEncrypted).toBeUndefined()
      expect(JSON.stringify(body)).not.toContain(PASSWORD)
    })
  })

  describe('round-trip through asusScanner', () => {
    it('decrypts the stored row into the Authorization header it sends', async () => {
      await POST(postRequest(VALID_BODY))

      // A router that answers success:true is what isAvailable() requires.
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as unknown as Response)

      const available = await asusScanner.isAvailable()
      expect(available).toBe(true)
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://192.168.1.1:8443/appGet.cgi?hook=wl_clientlist()')

      const headers = init.headers as Record<string, string>
      const [user, ...rest] = Buffer.from(
        headers.Authorization.replace('Basic ', ''),
        'base64'
      ).toString('utf8').split(':')
      expect(user).toBe('admin')
      expect(rest.join(':')).toBe(PASSWORD)
    })

    it('reports unavailable when the stored row is absent', async () => {
      const available = await asusScanner.isAvailable()
      expect(available).toBe(false)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})
