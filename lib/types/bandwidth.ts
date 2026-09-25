export type BandwidthRange = '1h' | '24h' | '7d' | '30d'
export type BandwidthResolution = 'raw' | 'hourly'

export interface BandwidthMetric {
  id: string
  deviceId: string
  timestamp: Date
  uploadSpeed: number
  downloadSpeed: number
  uploadTotal: string
  downloadTotal: string
  createdAt: Date
}

export interface BandwidthPoint {
  timestamp: Date
  uploadMbps: number
  downloadMbps: number
  uploadBytes: string
  downloadBytes: string
}

export interface BandwidthSeries {
  deviceId: string | null
  range: BandwidthRange
  resolution: BandwidthResolution
  points: BandwidthPoint[]
}

/**
 * Rolling network stats for one device, taken from its latest bandwidth
 * sample. Byte counters are strings: they exceed Number.MAX_SAFE_INTEGER
 * and JSON.stringify throws on a JS bigint (AUDIT.md A-05).
 */
export interface DeviceNetworkStats {
  lastSeenAt: Date
  uploadMbps: number
  downloadMbps: number
  uploadBytes: string
  downloadBytes: string
}