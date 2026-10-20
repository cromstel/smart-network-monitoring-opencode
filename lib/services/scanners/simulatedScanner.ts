import { Scanner, DiscoveredDevice, TrafficCounters } from './types'

/**
 * The simulated backend, used when no router is configured and no ARP
 * privileges are available.
 *
 * It also carries **traffic counters**, which is what makes the bandwidth
 * features demonstrable on a machine with no router: `bandwidthService`
 * differences consecutive readings to produce a rate, so this scanner keeps its
 * own cumulative counters and advances them by a plausible amount on each call.
 * Without this, every bandwidth read path (live throughput, totals, history,
 * top consumers) renders zero on the default `simulated` configuration and
 * looks broken even when the code is correct.
 *
 * The counters only ever increase, so a rate derived from them is always
 * positive and the reset-detection path in `bandwidthService` stays untriggered
 * in normal operation — it is exercised directly by tests instead.
 */

const SIM_DEVICES: Array<Omit<DiscoveredDevice, 'traffic'> & { mbps: number }> = [
  { macAddress: 'A4:83:E7:2C:11:09', ipAddress: '192.168.1.42', hostname: 'anas-iphone', signalStrength: -52, mbps: 4.2 },
  { macAddress: '3C:22:FB:44:90:12', ipAddress: '192.168.1.43', hostname: 'anas-macbook', signalStrength: -47, mbps: 12.8 },
  { macAddress: '58:8A:5A:71:CC:2F', ipAddress: '192.168.1.44', hostname: 'living-tv', signalStrength: undefined, mbps: 22.5 },
  { macAddress: 'D8:43:AE:12:AB:77', ipAddress: '192.168.1.45', hostname: 'sonos-kitchen', signalStrength: -61, mbps: 0.4 },
  { macAddress: 'B0:39:56:0D:39:11', ipAddress: '192.168.1.46', hostname: 'hp-office', signalStrength: undefined, mbps: 1.1 },
  { macAddress: 'F8:E4:3B:5A:90:C8', ipAddress: '192.168.1.47', hostname: 'ring-doorbell', signalStrength: -70, mbps: 0.9 },
  { macAddress: '34:E6:D7:00:BE:3A', ipAddress: '192.168.1.48', hostname: 'synology-nas', signalStrength: undefined, mbps: 8.6 },
  { macAddress: '04:9F:3E:22:11:5B', ipAddress: '192.168.1.49', hostname: 'desk-laptop', signalStrength: -55, mbps: 3.3 },
  { macAddress: '98:DA:32:7F:06:44', ipAddress: '192.168.1.50', hostname: 'kindle', signalStrength: -58, mbps: 0.05 },
  { macAddress: '48:CA:43:99:1B:E0', ipAddress: '192.168.1.51', hostname: 'nest-thermostat', signalStrength: -64, mbps: 0.02 },
  { macAddress: '1C:B7:2C:44:FF:02', ipAddress: '192.168.1.52', hostname: 'game-ps5', signalStrength: -50, mbps: 18.4 },
  { macAddress: '6C:37:2B:EE:26:81', ipAddress: '192.168.1.53', hostname: 'unifi-switch', signalStrength: undefined, mbps: 0.6 },
]

/**
 * Cumulative counters, keyed by MAC. Module-scope because the counters are the
 * simulated device's lifetime traffic — resetting them per call would make
 * every sample look like a reset.
 */
const counters = new Map<string, { up: number; down: number }>()

/** Exposed for tests so a simulation can start from a known state. */
export function resetSimulatedTraffic(): void {
  counters.clear()
}

function advance(mac: string, mbps: number, elapsedSeconds: number): TrafficCounters {
  const current = counters.get(mac) ?? { up: 0, down: 0 }

  // Split the nominal rate asymmetrically: most home traffic is inbound.
  const downloadBytes = Math.round((mbps * 0.75 * 1_000_000 * elapsedSeconds) / 8)
  const uploadBytes = Math.round((mbps * 0.25 * 1_000_000 * elapsedSeconds) / 8)

  const next = {
    up: current.up + uploadBytes,
    down: current.down + downloadBytes,
  }
  counters.set(mac, next)

  return { uploadBytes: next.up, downloadBytes: next.down }
}

export const simulatedScanner: Scanner = {
  name: 'simulated',

  async isAvailable(): Promise<boolean> {
    return true
  },

  async scan(_subnet: string): Promise<DiscoveredDevice[]> {
    // 30s is the default interval; using a fixed nominal value keeps the demo
    // traffic rate independent of how quickly a test calls scan() twice.
    const elapsedSeconds = 30

    return SIM_DEVICES.map((d) => ({
      macAddress: d.macAddress,
      ipAddress: d.ipAddress,
      hostname: d.hostname,
      signalStrength: d.signalStrength ?? undefined,
      traffic: advance(d.macAddress, d.mbps, elapsedSeconds),
    }))
  },
}
