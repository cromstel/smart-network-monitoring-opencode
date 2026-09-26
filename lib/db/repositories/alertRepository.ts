import { db } from '../client'
import type { DB } from '../schema'
import type { DeviceAlertRule, Notification } from '@/lib/types'
import { randomUUID } from 'node:crypto'

export async function listAlerts(userId: string): Promise<DeviceAlertRule[]> {
  const rows = await db
    .selectFrom('device_alerts')
    .where('user_id', '=', userId)
    .selectAll()
    .execute()

  return rows.map(rowToAlert)
}

export async function findAlertById(id: string, userId: string): Promise<DeviceAlertRule | null> {
  const row = await db
    .selectFrom('device_alerts')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst()

  return row ? rowToAlert(row) : null
}

export async function createAlert(input: {
  userId: string
  deviceId: string | null
  alertType: string
  threshold: number | null
}): Promise<DeviceAlertRule> {
  const now = new Date().toISOString()
  const id = randomUUID()

  await db.insertInto('device_alerts').values({
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
  }).execute()

  const alert = await findAlertById(id, input.userId)
  if (!alert) throw new Error('Failed to create alert')
  return alert
}

export async function updateAlert(id: string, userId: string, patch: Partial<DeviceAlertRule>): Promise<DeviceAlertRule | null> {
  const now = new Date().toISOString()
  const set: Record<string, string | number | null> = { updated_at: now }

  if ('deviceId' in patch) set.device_id = patch.deviceId ?? null
  if ('alertType' in patch) set.alert_type = patch.alertType!
  if ('threshold' in patch) set.threshold = patch.threshold ?? null
  if ('isActive' in patch) set.is_active = patch.isActive ? 1 : 0

  await db.updateTable('device_alerts').set(set).where('id', '=', id).where('user_id', '=', userId).execute()

  return findAlertById(id, userId)
}

export async function deleteAlert(id: string, userId: string): Promise<boolean> {
  const result = await db
    .deleteFrom('device_alerts')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst()

  return (result as any).numDeletedRows > 0
}

export async function getActiveAlertsForDevice(deviceId: string): Promise<DeviceAlertRule[]> {
  const rows = await db
    .selectFrom('device_alerts')
    .where('device_id', '=', deviceId)
    .where('is_active', '=', 1)
    .selectAll()
    .execute()

  return rows.map(rowToAlert)
}

export async function getActiveGlobalAlerts(alertType: string): Promise<DeviceAlertRule[]> {
  const rows = await db
    .selectFrom('device_alerts')
    .where('device_id', 'is', null)
    .where('alert_type', '=', alertType)
    .where('is_active', '=', 1)
    .selectAll()
    .execute()

  return rows.map(rowToAlert)
}

export async function triggerAlert(alertId: string): Promise<void> {
  await db.updateTable('device_alerts')
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
  type: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  data?: string | null
}): Promise<Notification> {
  const now = new Date().toISOString()
  const id = randomUUID()

  await db.insertInto('notifications').values({
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
  }).execute()

  const row = await db
    .selectFrom('notifications')
    .where('id', '=', id)
    .selectAll()
    .executeTakeFirst()

  return rowToNotification(row!)
}

export async function listNotifications(userId: string, options?: { unreadOnly?: boolean; limit?: number }): Promise<Notification[]> {
  let query = db.selectFrom('notifications').where('user_id', '=', userId).orderBy('created_at', 'desc')

  if (options?.unreadOnly) {
    query = query.where('is_read', '=', 0)
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  const rows = await query.selectAll().execute()
  return rows.map(rowToNotification)
}

export async function markNotificationRead(id: string, userId: string): Promise<void> {
  await db.updateTable('notifications')
    .set({ is_read: 1, read_at: new Date().toISOString() })
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .execute()
}

function rowToAlert(row: { id: string; user_id: string; device_id: string | null; alert_type: string; threshold: number | null; is_active: number; last_triggered: string | null; trigger_count: number; created_at: string; updated_at: string }): DeviceAlertRule {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    alertType: row.alert_type as 'unknown_device' | 'bandwidth_exceeded' | 'device_offline',
    threshold: row.threshold,
    isActive: row.is_active === 1,
    lastTriggered: row.last_triggered ? new Date(row.last_triggered) : null,
    triggerCount: row.trigger_count,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function rowToNotification(row: { id: string; user_id: string; device_id: string | null; alert_id: string | null; title: string; message: string; type: string; priority: string; is_read: number; read_at: string | null; data: string | null; created_at: string }): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    alertId: row.alert_id,
    title: row.title,
    message: row.message,
    type: row.type as any,
    priority: row.priority as any,
    isRead: row.is_read === 1,
    readAt: row.read_at ? new Date(row.read_at) : null,
    data: row.data,
    createdAt: new Date(row.created_at),
  }
}