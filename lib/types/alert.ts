export type AlertType = 'unknown_device' | 'bandwidth_exceeded' | 'device_offline'

/**
 * Declared as a tuple so `z.enum(KNOWN_ALERT_TYPES)` infers the literal union
 * at the route boundary instead of widening to `string`.
 */
export const KNOWN_ALERT_TYPES = ['unknown_device', 'bandwidth_exceeded', 'device_offline'] as const satisfies readonly AlertType[]

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
