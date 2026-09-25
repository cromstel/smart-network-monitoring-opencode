import { simulatedScanner } from '../simulatedScanner'

describe('simulatedScanner', () => {
  it('is always available', async () => {
    await expect(simulatedScanner.isAvailable()).resolves.toBe(true)
  })

  it('returns a deterministic set of devices matching the seed', async () => {
    const devices = await simulatedScanner.scan('192.168.1.0/24')

    expect(devices).toHaveLength(12)
    expect(devices[0].macAddress).toBe('A4:83:E7:2C:11:09')
    expect(devices[0].ipAddress).toBe('192.168.1.42')
    expect(devices[0].hostname).toBe('anas-iphone')
    expect(devices[0].signalStrength).toBe(-52)
  })

  it('returns all MACs in canonical uppercase colon format', async () => {
    const devices = await simulatedScanner.scan('192.168.1.0/24')
    const macRegex = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/

    for (const d of devices) {
      expect(d.macAddress).toMatch(macRegex)
    }
  })

  it('includes signal strength as number or undefined (never null)', async () => {
    const devices = await simulatedScanner.scan('192.168.1.0/24')

    for (const d of devices) {
      if (d.signalStrength !== undefined) {
        expect(typeof d.signalStrength).toBe('number')
        expect(d.signalStrength).toBeLessThanOrEqual(0)
      }
    }
  })

  it('is deterministic across multiple calls', async () => {
    const a = await simulatedScanner.scan('192.168.1.0/24')
    const b = await simulatedScanner.scan('192.168.1.0/24')

    expect(a).toEqual(b)
  })
})