import { arpScanner } from '../arpScanner'

describe('arpScanner', () => {
  it('isAvailable resolves false when binary is missing (no throw)', async () => {
    await expect(arpScanner.isAvailable()).resolves.toBe(false)
  })

  it('isAvailable caches the result', async () => {
    await arpScanner.isAvailable()
    const start = Date.now()
    await arpScanner.isAvailable()
    expect(Date.now() - start).toBeLessThan(50)
  })

  it('scan throws when unavailable', async () => {
    await expect(arpScanner.scan('192.168.1.0/24')).rejects.toThrow(
      'arpScanner unavailable'
    )
  })
})