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
  paystackApiUrl: string
  paystackSecret: string
  paystackAccessToken: string
  paystackSubscriptionId: string
  createdAt: Date
  updatedAt: Date
}