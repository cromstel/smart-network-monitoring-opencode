import { simulatedScanner, resetSimulatedTraffic } from '../simulatedScanner'

describe('simulatedScanner', () => {
  beforeEach(() => {
    resetSimulatedTraffic()
  })

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

  it('reports the same device identities across multiple calls', async () => {
    const a = await simulatedScanner.scan('192.168.1.0/24')
    const b = await simulatedScanner.scan('192.168.1.0/24')

    // Identity is stable; the traffic *counters* are not, and must not be.
    // This scanner models a device's lifetime bytes, so a second scan a moment
    // later legitimately reports more. Comparing whole objects would assert
    // that a network carries no traffic between scans.
    const identity = (d: (typeof a)[number]) => ({
      macAddress: d.macAddress,
      ipAddress: d.ipAddress,
      hostname: d.hostname,
      signalStrength: d.signalStrength,
    })

    expect(a.map(identity)).toEqual(b.map(identity))
  })

  it('advances the cumulative traffic counters on every scan', async () => {
    // The counters are what the bandwidth sampler differences to derive a rate.
    // A scanner that returned a constant would produce a permanent zero Mbps.
    resetSimulatedTraffic()
    const a = await simulatedScanner.scan('192.168.1.0/24')
    const b = await simulatedScanner.scan('192.168.1.0/24')

    expect(a[0].traffic).toBeDefined()
    for (let i = 0; i < a.length; i += 1) {
      expect(b[i].traffic!.downloadBytes).toBeGreaterThan(a[i].traffic!.downloadBytes)
      expect(b[i].traffic!.uploadBytes).toBeGreaterThan(a[i].traffic!.uploadBytes)
    }
  })

  it('starts counters from zero after a reset', async () => {
    resetSimulatedTraffic()
    const devices = await simulatedScanner.scan('192.168.1.0/24')
    // First call after reset: the counter is exactly this scan's traffic.
    expect(devices[0].traffic!.uploadBytes).toBeGreaterThan(0)
    expect(devices[0].traffic!.downloadBytes).toBeGreaterThan(devices[0].traffic!.uploadBytes)
  })
})