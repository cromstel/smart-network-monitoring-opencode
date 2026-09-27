import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db/client'
import { createMigrator } from '@/lib/db/migrator'
import { encrypt } from '@/lib/utils/encryption'
import { asusScanner, invalidateConfigCache } from '../asusScanner'
import type { DiscoveredDevice } from '../types'

jest.mock('@/lib/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(() => ({
    DB_CLIENT: 'sqlite',
    NETWORK_SUBNET: '192.168.1.0/24',
    SCANNER_MODE: 'asus',
    SCAN_INTERVAL_SECONDS: 30,
    // The scanner decrypts the stored password, which reads ENCRYPTION_KEY.
    ENCRYPTION_KEY: 'b'.repeat(64),
    NODE_ENV: 'test',
  })),
}))

/** Minimal router-config row; the client only reads these six columns. */
async function seedRouter(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID()
  const now = new Date().toISOString()

  await db
    .insertInto('router_config')
    .values({
      id,
      router_type: 'asus',
      router_name: 'Test Router',
      router_ip: '192.168.1.1',
      port: 8443,
      username: 'admin',
      password_encrypted: encrypt('super-secret'),
      is_connected: 1,
      ...overrides,
      created_at: now,
      updated_at: now,
    } as never)
    .execute()

  return id
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as unknown as Response
}

describe('asusScanner', () => {
  const originalFetch = global.fetch
  let fetchMock: jest.Mock

  beforeAll(async () => {
    const result = await createMigrator(db).migrateToLatest()
    if (result.error) throw result.error
  })

  beforeEach(async () => {
    await db.deleteFrom('router_config').execute()
    invalidateConfigCache()
    asusScanner._cachedAvailable = undefined

    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  afterAll(async () => {
    await db.destroy()
    delete (globalThis as { __db?: unknown }).__db
  })

  it('reports unavailable when no router is configured', async () => {
    expect(await asusScanner.isAvailable()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports unavailable when the router is not marked connected', async () => {
    await seedRouter({ is_connected: 0 })
    expect(await asusScanner.isAvailable()).toBe(false)
  })

  it('reports available when the router answers the client list hook', async () => {
    await seedRouter()
    fetchMock.mockResolvedValue(okResponse({ success: true, devices: [] }))

    expect(await asusScanner.isAvailable()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('192.168.1.1:8443')
    expect(url).toContain('wl_clientlist')
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /)
  })

  it('sends basic auth built from the decrypted password, never the ciphertext', async () => {
    await seedRouter()
    fetchMock.mockResolvedValue(okResponse({ success: true, devices: [] }))
    await asusScanner.isAvailable()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const auth = (init.headers as Record<string, string>).Authorization!
    const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString('utf8')

    expect(decoded).toBe('admin:super-secret')
    // The value on disk is ciphertext and must never appear on the wire.
    expect(auth).not.toContain('b'.repeat(64))
  })

  it('reports unavailable when the router returns a non-2xx status', async () => {
    await seedRouter()
    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' })

    expect(await asusScanner.isAvailable()).toBe(false)
  })

  it('reports unavailable when the router rejects the credentials', async () => {
    await seedRouter()
    fetchMock.mockResolvedValue(okResponse({ success: false, error: 'login failed' }))

    expect(await asusScanner.isAvailable()).toBe(false)
  })

  it('reports unavailable when the request throws', async () => {
    await seedRouter()
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    expect(await asusScanner.isAvailable()).toBe(false)
  })

  it('returns only online devices, uppercased, with signal strength', async () => {
    await seedRouter()
    asusScanner._cachedAvailable = true // skip the availability probe

    fetchMock.mockResolvedValue(
      okResponse({
        success: true,
        devices: [
          { mac: 'a4:83:e7:2c:11:09', ip: '192.168.1.42', name: 'iphone', online: 1, rssi: -52 },
          { mac: '3C:22:FB:44:90:12', ip: '192.168.1.43', name: '', online: 0 },
          { mac: '58:8a:5a:71:cc:2f', ip: '192.168.1.44', name: 'tv', online: 1 },
        ],
      })
    )

    const devices: DiscoveredDevice[] = await asusScanner.scan('192.168.1.0/24')

    // The offline client (online: 0) is dropped entirely.
    expect(devices).toHaveLength(2)
    expect(devices[0]).toEqual({
      macAddress: 'A4:83:E7:2C:11:09',
      ipAddress: '192.168.1.42',
      hostname: 'iphone',
      signalStrength: -52,
    })
    // A client with no signal reading reports undefined rather than 0.
    expect(devices[1]).toEqual({
      macAddress: '58:8A:5A:71:CC:2F',
      ipAddress: '192.168.1.44',
      hostname: 'tv',
      signalStrength: undefined,
    })
  })

  it('throws when the router returns a malformed success payload', async () => {
    await seedRouter()
    asusScanner._cachedAvailable = true

    fetchMock.mockResolvedValue(okResponse({ success: true }))

    await expect(asusScanner.scan('192.168.1.0/24')).rejects.toThrow(/Invalid response/)
  })

  it('throws when the router reports an error', async () => {
    await seedRouter()
    asusScanner._cachedAvailable = true

    fetchMock.mockResolvedValue(okResponse({ success: false, error: 'busy' }))

    await expect(asusScanner.scan('192.168.1.0/24')).rejects.toThrow('busy')
  })

  it('fails loudly when the stored password cannot be decrypted', async () => {
    await seedRouter({ password_encrypted: 'not-a-valid-ciphertext' })
    asusScanner._cachedAvailable = true

    // No request should be attempted with an unusable credential.
    await expect(asusScanner.scan('192.168.1.0/24')).rejects.toThrow()
  })
})
