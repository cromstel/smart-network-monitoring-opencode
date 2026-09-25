export type ConnectionEventType = 'connected' | 'disconnected'

export interface ConnectionLog {
  id: string
  deviceId: string
  eventType: ConnectionEventType
  timestamp: Date
  ipAddress: string | null
  connectionDuration: number | null
  createdAt: Date
}