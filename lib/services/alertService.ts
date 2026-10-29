import { randomUUID } from 'node:crypto'
import * as alertRepo from '@/lib/db/repositories/alertRepository'
import * as deviceRepo from '@/lib/db/repositories/deviceRepository'
import { eventBusInstance, type AlertRaisedEvent, type AlertFanoutEvent } from '@/lib/services/eventBus'
import { isNotificationEnabled } from '@/lib/services/notificationPreferences'
import { getEffectiveScanSettings } from '@/lib/services/runtimeSettings'
import { logger } from '@/lib/utils/logger'
import type {
  AlertType,
  Device,
  DeviceAlertRule,
  EnrichedDevice,
  Notification,
  NotificationPriority,
} from '@/lib/types'

/**
 * Alert rule engine.
 *
 * Two invariants matter more than anything else here:
 *
 *  1. **One connection, one alert.** A device that stays online is re-seen on
 *     every scan. Alerts are only raised on a transition (new device, or
 *     offline -> online), and `upsertFromScan` reports whether the row was
 *     inserted, so repeated scans cannot duplicate a notification.
 *
 *  2. **Owner scoping (PRD F-34).** Every rule carries a `userId` and every
 *     notification is written for exactly that owner. Global rules
 *     (`deviceId === null`) are read across owners on purpose — each owner
 *     configured their own — but the notification is still written only to the
 *     rule's owner. Covered by `alertEngine.leak.test.ts`.
 */

const MISSED_SCANS_BEFORE_OFFLINE = 2

function nowIso(): string {
  return new Date().toISOString()
}

function deviceLabel(device: Device): string {
  return device.deviceName || device.macAddress
}

async function raise(
  rule: DeviceAlertRule,
  device: Device,
  title: string,
  message: string,
  priority: NotificationPriority
): Promise<Notification> {
  const notification = await alertRepo.createNotification({
    userId: rule.userId,
    deviceId: device.id,
    alertId: rule.id,
    title,
    message,
    type: rule.alertType,
    priority,
    data: JSON.stringify({
      deviceId: device.id,
      macAddress: device.macAddress,
      ipAddress: device.ipAddress,
    }),
  })

  await alertRepo.triggerAlert(rule.id)

  const event: AlertRaisedEvent = {
    type: 'alert.raised',
    timestamp: nowIso(),
    userId: rule.userId,
    payload: {
      alertId: rule.id,
      deviceId: device.id,
      alertType: rule.alertType,
      message: notification.message,
      priority,
    },
  }
  eventBusInstance.emit(event)

  logger.info(
    { alertId: rule.id, deviceId: device.id, userId: rule.userId, alertType: rule.alertType },
    'alert raised'
  )
  return notification
}

/**
 * Emits one `alert.fanout` event per evaluation pass, listing the rule owners
 * who already got their per-user notification so the admin-group subscriber
 * can skip them.
 *
 * Called once per `evaluate*` pass (not once per rule) because the whole pass
 * is one logical event: "these devices tripped this alert type". Emitting per
 * rule would send the admin group one message per matching rule, which for N
 * owners of the same global rule is N near-identical emails.
 *
 * A pass that raised nothing emits nothing — an admin group that was told
 * "no alerts fired" on every scan would learn to ignore the channel.
 */
function emitFanout(input: {
  alertType: string
  deviceId: string | null
  title: string
  message: string
  priority: NotificationPriority
  notifiedUserIds: string[]
}): void {
  if (input.notifiedUserIds.length === 0) return

  const event: AlertFanoutEvent = {
    type: 'alert.fanout',
    timestamp: nowIso(),
    payload: {
      alertType: input.alertType,
      deviceId: input.deviceId,
      title: input.title,
      message: input.message,
      priority: input.priority,
      excludeUserIds: input.notifiedUserIds,
    },
  }
  eventBusInstance.emit(event)
}

/** F-30: a device nobody has seen before. */
export async function evaluateUnknownDevice(device: Device): Promise<void> {
  const rules = await alertRepo.getActiveGlobalAlerts('unknown_device')
  const notified: string[] = []
  const title = 'Unknown device connected'
  const message = `${deviceLabel(device)} (${device.macAddress}) joined the network at ${device.ipAddress}`

  for (const rule of rules) {
    // F-52: the rule's owner may have switched this type off.
    if (!(await isNotificationEnabled(rule.userId, rule.alertType))) continue

    await raise(rule, device, title, message, 'high')
    notified.push(rule.userId)
  }

  emitFanout({
    alertType: 'unknown_device',
    deviceId: device.id,
    title,
    message,
    priority: 'high',
    notifiedUserIds: notified,
  })
}

/** F-32: a named device stopped answering scans. */
export async function evaluateDeviceOffline(devices: Device[]): Promise<void> {
  if (devices.length === 0) return

  // The interval that actually governs scanning may be a saved setting rather
  // than the env default, and the alert text quotes it — reporting 60s to a
  // user who configured 120s is a small lie that erodes trust in the alert.
  const { scanIntervalSeconds } = await getEffectiveScanSettings()

  await Promise.all(
    devices.map(async (device) => {
      const [bound, global] = await Promise.all([
        alertRepo.getActiveAlertsForDevice(device.id),
        alertRepo.getActiveGlobalAlerts('device_offline'),
      ])
      const offline = [...bound, ...global].filter((r) => r.alertType === 'device_offline')
      const notified: string[] = []
      const title = 'Device went offline'
      const message = `${deviceLabel(device)} has not responded for ${
        scanIntervalSeconds * MISSED_SCANS_BEFORE_OFFLINE
      } seconds`

      for (const rule of offline) {
        if (!(await isNotificationEnabled(rule.userId, rule.alertType))) continue

        await raise(rule, device, title, message, 'medium')
        notified.push(rule.userId)
      }

      // One fan-out per device: each offline device is its own incident with
      // its own message, so folding them into a single group notification
      // would lose which device went away.
      emitFanout({
        alertType: 'device_offline',
        deviceId: device.id,
        title,
        message,
        priority: 'medium',
        notifiedUserIds: notified,
      })
    })
  )
}

/** F-31: a device exceeded the user's configured Mbps threshold. */
export async function evaluateBandwidthThreshold(device: EnrichedDevice): Promise<void> {
  if (!device.network) return

  const rules = await alertRepo.getActiveAlertsForDevice(device.device.id)
  const totalMbps = device.network.downloadMbps + device.network.uploadMbps

  const notified: string[] = []
  let thresholdSeen: number | null = null
  const title = 'Bandwidth threshold exceeded'

  for (const rule of rules) {
    if (rule.alertType !== 'bandwidth_exceeded' || rule.threshold == null) continue
    if (totalMbps <= rule.threshold) continue
    if (!(await isNotificationEnabled(rule.userId, rule.alertType))) continue

    thresholdSeen = rule.threshold
    const message = `${deviceLabel(device.device)} is using ${totalMbps.toFixed(1)} Mbps, above the ${rule.threshold} Mbps limit`
    await raise(rule, device.device, title, message, 'high')
    notified.push(rule.userId)
  }

  if (notified.length === 0) return

  emitFanout({
    alertType: 'bandwidth_exceeded',
    deviceId: device.device.id,
    title,
    message: `${deviceLabel(device.device)} is using ${totalMbps.toFixed(1)} Mbps, above the ${thresholdSeen} Mbps limit`,
    priority: 'high',
    notifiedUserIds: notified,
  })
}

// ---------------------------------------------------------------------------
// Owner-scoped CRUD used by the API layer
// ---------------------------------------------------------------------------

export async function getUserAlerts(userId: string): Promise<DeviceAlertRule[]> {
  return alertRepo.listAlerts(userId)
}

export async function createAlert(input: {
  userId: string
  deviceId: string | null
  alertType: AlertType
  threshold?: number
}): Promise<DeviceAlertRule> {
  return alertRepo.createAlert({
    userId: input.userId,
    deviceId: input.deviceId,
    alertType: input.alertType,
    threshold: input.threshold ?? null,
  })
}

export async function updateAlert(
  id: string,
  userId: string,
  patch: alertRepo.AlertPatch
): Promise<DeviceAlertRule | null> {
  return alertRepo.updateAlert(id, userId, patch)
}

export async function deleteAlert(id: string, userId: string): Promise<boolean> {
  return alertRepo.deleteAlert(id, userId)
}

export async function getUserNotifications(
  userId: string,
  options?: { unreadOnly?: boolean; readOnly?: boolean; limit?: number; type?: string }
): Promise<Notification[]> {
  return alertRepo.listNotifications(userId, options)
}

export async function countUnread(userId: string): Promise<number> {
  return alertRepo.countUnreadNotifications(userId)
}

export async function markNotificationRead(id: string, userId: string): Promise<boolean> {
  return alertRepo.markNotificationRead(id, userId)
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  return alertRepo.markAllNotificationsRead(userId)
}
