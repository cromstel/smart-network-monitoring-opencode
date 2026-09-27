import { randomUUID } from 'node:crypto'
import { db } from '../client'
import type { DeviceAlertRule, Notification, NotificationPriority, NotificationType, AlertType } from '@/lib/types'

/**
 * Alert rules and the activity log.
 *
 * Every read is filtered by `user_id` (PRD F-34). Cross-user notification
 * leakage has bitten a related project before, so the scoping is enforced here
 * at the repository boundary rather than left to callers, and covered by
 * `lib/services/__tests__/alertEngine.leak.test.ts`.
 */

const ALERT_TYPES: readonly AlertType[] = ['unknown_device', 'bandwidth_exceeded', 'device_offline']
const NOTIFICATION_TYPES: readonly NotificationType[] = [
  ...ALERT_TYPES,
  'info',
  'success',
  'warning',
  'error',
]
const PRIORITIES: readonly NotificationPriority[] = ['low', 'medium', 'high', 'critical']

function toAlertType(value: string): AlertType {
  if ((ALERT_TYPES as readonly string[]).includes(value)) return value as AlertType
  // A value written outside KNOWN_ALERT_TYPES must not crash the activity log.
  return 'unknown_device'
}

function toNotificationType(value: string): NotificationType {
  if ((NOTIFICATION_TYPES as readonly string[]).includes(value)) return value as NotificationType
  return 'info'
}

function toPriority(value: string): NotificationPriority {
  if ((PRIORITIES as readonly string[]).includes(value)) return value as NotificationPriority
  return 'medium'
}

interface AlertRow {
  id: string
  user_id: string
  device_id: string | null
  alert_type: string
  threshold: number | null
  is_active: number
  last_triggered: string | null
  trigger_count: number
  created_at: string
  updated_at: string
}

interface NotificationRow {
  id: string
  user_id: string
  device_id: string | null
  alert_id: string | null
  title: string
  message: string
  type: string
  priority: string
  is_read: number
  read_at: string | null
  data: string | null
  created_at: string
}

function rowToAlert(row: AlertRow): DeviceAlertRule {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    alertType: toAlertType(row.alert_type),
    threshold: row.threshold,
    isActive: row.is_active === 1,
    lastTriggered: row.last_triggered ? new Date(row.last_triggered) : null,
    triggerCount: row.trigger_count,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function rowToNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    alertId: row.alert_id,
    title: row.title,
    message: row.message,
    type: toNotificationType(row.type),
    priority: toPriority(row.priority),
    isRead: row.is_read === 1,
    readAt: row.read_at ? new Date(row.read_at) : null,
    data: row.data,
    createdAt: new Date(row.created_at),
  }
}

export async function listAlerts(userId: string): Promise<DeviceAlertRule[]> {
  const rows = await db
    .selectFrom('device_alerts')
    .where('user_id', '=', userId)
    .orderBy('created_at', 'asc')
    .selectAll()
    .execute()

  return rows.map((row) => rowToAlert(row as AlertRow))
}

export async function findAlertById(id: string, userId: string): Promise<DeviceAlertRule | null> {
  const row = await db
    .selectFrom('device_alerts')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst()

  return row ? rowToAlert(row as AlertRow) : null
}

export async function createAlert(input: {
  userId: string
  deviceId: string | null
  alertType: AlertType
  threshold: number | null
}): Promise<DeviceAlertRule> {
  const now = new Date().toISOString()
  const id = randomUUID()

  await db
    .insertInto('device_alerts')
    .values({
      id,
      user_id: input.userId,
      device_id: input.deviceId,
      alert_type: input.alertType,
      threshold: input.threshold,
      is_active: 1,
      last_triggered: null,
      trigger_count: 0,
      created_at: now,
      updated_at: now,
    })
    .execute()

  const created = await findAlertById(id, input.userId)
  if (!created) throw new Error('Alert insert did not persist')
  return created
}

export interface AlertPatch {
  deviceId?: string | null
  alertType?: AlertType
  threshold?: number | null
  isActive?: boolean
}

export async function updateAlert(
  id: string,
  userId: string,
  patch: AlertPatch
): Promise<DeviceAlertRule | null> {
  const set: Record<string, string | number | null> = { updated_at: new Date().toISOString() }

  if ('deviceId' in patch) set.device_id = patch.deviceId ?? null
  if ('alertType' in patch && patch.alertType) set.alert_type = patch.alertType
  if ('threshold' in patch) set.threshold = patch.threshold ?? null
  if ('isActive' in patch) set.is_active = patch.isActive ? 1 : 0

  await db
    .updateTable('device_alerts')
    .set(set)
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .execute()

  return findAlertById(id, userId)
}

export async function deleteAlert(id: string, userId: string): Promise<boolean> {
  // Confirm ownership first: an id belonging to another user must report
  // "not found" semantics via a false return without touching their row.
  const existing = await findAlertById(id, userId)
  if (!existing) return false

  await db.deleteFrom('device_alerts').where('id', '=', id).where('user_id', '=', userId).execute()
  return true
}

/** Rules bound to one device. Used when evaluating a device-level event. */
export async function getActiveAlertsForDevice(deviceId: string): Promise<DeviceAlertRule[]> {
  const rows = await db
    .selectFrom('device_alerts')
    .where('device_id', '=', deviceId)
    .where('is_active', '=', 1)
    .selectAll()
    .execute()

  return rows.map((row) => rowToAlert(row as AlertRow))
}

/** Global rules (`device_id IS NULL`) of one type, across all owners. */
export async function getActiveGlobalAlerts(alertType: AlertType): Promise<DeviceAlertRule[]> {
  const rows = await db
    .selectFrom('device_alerts')
    .where('device_id', 'is', null)
    .where('alert_type', '=', alertType)
    .where('is_active', '=', 1)
    .selectAll()
    .execute()

  return rows.map((row) => rowToAlert(row as AlertRow))
}

export async function triggerAlert(alertId: string): Promise<void> {
  await db
    .updateTable('device_alerts')
    .set({
      last_triggered: new Date().toISOString(),
      trigger_count: (eb) => eb('trigger_count', '+', 1),
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', alertId)
    .execute()
}

export async function createNotification(input: {
  userId: string
  deviceId: string | null
  alertId: string | null
  title: string
  message: string
  type: NotificationType
  priority: NotificationPriority
  data?: string | null
}): Promise<Notification> {
  const now = new Date().toISOString()
  const id = randomUUID()

  await db
    .insertInto('notifications')
    .values({
      id,
      user_id: input.userId,
      device_id: input.deviceId,
      alert_id: input.alertId,
      title: input.title,
      message: input.message,
      type: input.type,
      priority: input.priority,
      is_read: 0,
      read_at: null,
      data: input.data ?? null,
      created_at: now,
    })
    .execute()

  const row = await db.selectFrom('notifications').where('id', '=', id).selectAll().executeTakeFirst()
  if (!row) throw new Error('Notification insert did not persist')
  return rowToNotification(row as NotificationRow)
}

export async function listNotifications(
  userId: string,
  options?: { unreadOnly?: boolean; limit?: number; type?: string }
): Promise<Notification[]> {
  let query = db
    .selectFrom('notifications')
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')

  if (options?.unreadOnly) query = query.where('is_read', '=', 0)
  if (options?.type) query = query.where('type', '=', options.type)
  if (options?.limit) query = query.limit(Math.min(options.limit, 500))

  const rows = await query.selectAll().execute()
  return rows.map((row) => rowToNotification(row as NotificationRow))
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const row = await db
    .selectFrom('notifications')
    .where('user_id', '=', userId)
    .where('is_read', '=', 0)
    .select(db.fn.countAll<number>().as('count'))
    .executeTakeFirst()

  return Number(row?.count ?? 0)
}

export async function markNotificationRead(id: string, userId: string): Promise<boolean> {
  const result = await db
    .updateTable('notifications')
    .set({ is_read: 1, read_at: new Date().toISOString() })
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst()

  return Number((result as { numUpdatedRows?: bigint | number })?.numUpdatedRows ?? 0) > 0
}
