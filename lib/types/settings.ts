export interface UserSettings {
  id: string
  userId: string
  scanIntervalSeconds: number
  dataRetentionDays: number
  networkSubnet: string
  ignoreSubnets: string | null
  notifyNewDevices: boolean
  notifyDeviceOffline: boolean
  notifyHighBandwidth: boolean
  bandwidthThreshold: number
  theme: 'dark' | 'light'
  createdAt: Date
  updatedAt: Date
}