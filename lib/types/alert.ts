export type AlertType = 'unknown_device' | 'bandwidth_exceeded' | 'device_offline'

export const KNOWN_ALERT_TYPES: readonly AlertType[] = [
  'unknown_device',
  'bandwidth_exceeded',
  'device_offline',
]

export interface DeviceAlertRule {
  id: string
  userId: string
  deviceId: string | null
  alertType: AlertType
  threshold: number | null
  isActive: boolean
  lastTriggered: Date | null
  triggerCount: number
  createdAt: Date
  updatedAt: Date
}