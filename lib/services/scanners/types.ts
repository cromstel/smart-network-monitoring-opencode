export interface DiscoveredDevice {
  macAddress: string
  ipAddress: string
  hostname?: string
  manufacturer?: string
  signalStrength?: number
}

export interface Scanner {
  readonly name: 'simulated' | 'arp' | 'asus'
  isAvailable(): Promise<boolean>
  scan(subnet: string): Promise<DiscoveredDevice[]>
  _cachedAvailable?: boolean | null
}

export type ScannerMode = 'simulated' | 'arp' | 'asus'