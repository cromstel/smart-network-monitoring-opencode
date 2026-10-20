jest.mock('@/lib/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { reverse } from 'node:dns/promises'
import {
  resolveHostname,
  resolveHostnamesForDevices,
  clearHostnameCache,
} from '@/lib/services/reverseDns'

jest.mock('node:dns/promises', () => ({
  reverse: jest.fn(),
}))

const reverseMock = reverse as jest.MockedFunction<typeof reverse>

/**
 * F-03 was absent entirely: nothing in `lib/` imported `node:dns`, so a device
 * the router could not name stayed nameless forever. These tests pin the
 * behaviour that makes the fallback safe on a real LAN — bounded, batched,
 * cached, and never able to fail a scan.
 */
describe('reverseDns — hostname fallback (F-03)', () => {
  beforeEach(() => {
    clearHostnameCache()
    reverseMock.mockReset()
  })

  it('returns the PTR name, stripped of its trailing dot', async () => {
    reverseMock.mockResolvedValue(['nas.local.'] as never)
    await expect(resolveHostname('192.168.1.48')).resolves.toBe('nas.local')
  })

  it('returns null when there is no PTR record', async () => {
    reverseMock.mockRejectedValue(Object.assign(new Error('NXDOMAIN'), { code: 'ENOTFOUND' }))
    await expect(resolveHostname('192.168.1.99')).resolves.toBeNull()
  })

  it('rejects an answer that merely echoes the address back', async () => {
    // Some resolvers do this. Storing it would duplicate the IP column in the UI
    // while looking like a successful lookup.
    reverseMock.mockResolvedValue(['192.168.1.42'] as never)
    await expect(resolveHostname('192.168.1.42')).resolves.toBeNull()
  })

  it('returns null when the resolver returns an empty list', async () => {
    reverseMock.mockResolvedValue([] as never)
    await expect(resolveHostname('192.168.1.43')).resolves.toBeNull()
  })

  it('caches a positive result instead of re-asking every scan', async () => {
    reverseMock.mockResolvedValue(['phone.local'] as never)
    await resolveHostname('192.168.1.42')
    await resolveHostname('192.168.1.42')
    expect(reverseMock).toHaveBeenCalledTimes(1)
  })

  it('caches a negative result too', async () => {
    reverseMock.mockRejectedValue(new Error('NXDOMAIN'))
    await resolveHostname('192.168.1.77')
    await resolveHostname('192.168.1.77')
    expect(reverseMock).toHaveBeenCalledTimes(1)
  })

  it('never looks up an address the scanner already named', async () => {
    const resolved = await resolveHostnamesForDevices([
      { macAddress: 'AA:BB:CC:00:00:01', ipAddress: '192.168.1.42', hostname: 'from-router' },
    ])

    expect(resolved.size).toBe(0)
    expect(reverseMock).not.toHaveBeenCalled()
  })

  it('does not query public addresses, which would be a privacy leak', async () => {
    const resolved = await resolveHostnamesForDevices([
      { macAddress: 'AA:BB:CC:00:00:02', ipAddress: '8.8.8.8' },
    ])

    expect(resolved.size).toBe(0)
    expect(reverseMock).not.toHaveBeenCalled()
  })

  it('maps resolved names back to their MAC', async () => {
    reverseMock.mockImplementation((ip: string) =>
      Promise.resolve([`host-${ip.split('.').pop()}.local`] as never)
    )

    const resolved = await resolveHostnamesForDevices([
      { macAddress: 'aa:bb:cc:00:00:03', ipAddress: '192.168.1.50' },
      { macAddress: 'AA:BB:CC:00:00:04', ipAddress: '192.168.1.51' },
    ])

    expect(resolved.get('AA:BB:CC:00:00:03')).toBe('host-50.local')
    expect(resolved.get('AA:BB:CC:00:00:04')).toBe('host-51.local')
  })

  it('survives a resolver that rejects for every device', async () => {
    reverseMock.mockRejectedValue(new Error('resolver down'))
    const resolved = await resolveHostnamesForDevices([
      { macAddress: 'AA:BB:CC:00:00:05', ipAddress: '192.168.1.60' },
      { macAddress: 'AA:BB:CC:00:00:06', ipAddress: '192.168.1.61' },
    ])
    expect(resolved.size).toBe(0)
  })
})
