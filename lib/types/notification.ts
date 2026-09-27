import type { AlertType } from './alert'

/**
 * The activity log stores the originating rule's type (e.g. `unknown_device`)
 * so the UI can filter by it, plus generic kinds for non-alert events.
 */
export type NotificationType = AlertType | 'info' | 'success' | 'warning' | 'error'

export type NotificationPriority = 'low' | 'medium' | 'high' | 'critical'

export interface Notification {
  id: string
  userId: string
  deviceId: string | null
  alertId: string | null
  title: string
  message: string
  type: NotificationType
  priority: NotificationPriority
  isRead: boolean
  readAt: Date | null
  data: string | null
  createdAt: Date
}
