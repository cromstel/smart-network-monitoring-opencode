/**
 * Cumulative byte counters as reported by a router, in bytes since the router
 * last rebooted. Both are optional: a scanner that cannot read them (ARP,
 * simulated) simply omits the field, and no bandwidth sample is written for
 * that device rather than a fabricated zero being stored.
 *
 * These are *cumulative*, never a rate. `bandwidthService` differences
 * consecutive readings to get throughput, which is the only way to derive a
 * rate from hardware that reports totals.
 */
export interface TrafficCounters {
  /** Cumulative bytes sent by the device, as the router counts them. */
  uploadBytes: number
  /** Cumulative bytes received by the device, as the router counts them. */
  downloadBytes: number
}

export interface DiscoveredDevice {
  macAddress: string
  ipAddress: string
  hostname?: string
  manufacturer?: string
  signalStrength?: number
  /** Present only when the scanner can read the router's per-device counters. */
  traffic?: TrafficCounters
}

export interface Scanner {
  readonly name: 'simulated' | 'arp' | 'asus'
  isAvailable(): Promise<boolean>
  scan(subnet: string): Promise<DiscoveredDevice[]>
  _cachedAvailable?: boolean | null
}

export type ScannerMode = 'simulated' | 'arp' | 'asus'