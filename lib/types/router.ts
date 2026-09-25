export type RouterType = 'asus' | 'tplink' | 'netgear' | 'generic'

export interface RouterConfig {
  id: string
  routerType: RouterType
  routerName: string | null
  routerIp: string
  port: number
  username: string
  passwordEncrypted: string
  macAddress: string | null
  modelNumber: string | null
  firmwareVersion: string | null
  isConnected: boolean
  lastCheckAt: Date | null
  lastSuccessAt: Date | null
  createdAt: Date
  updatedAt: Date
}