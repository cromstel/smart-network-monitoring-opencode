import * as alertRepo from '@/lib/db/repositories/alertRepository'
import * as deviceRepo from '@/lib/db/repositories/deviceRepository'
import * as deviceService from '@/lib/services/deviceService'
import { eventBusInstance, AppEvent, AlertRaisedEvent } from '@/lib/services/eventBus'
import { logger } from '@/lib/utils/logger'
import { getConfig } from '@/lib/config'
import type { Device, EnrichedDevice, DeviceAlertRule, Notification } from '@/lib/types'

const MISSED_SCANS_BEFORE_OFFLINE = 2

export async function evaluateDeviceOfflineAlerts(): Promise<void> {
  const config = getConfig()
  const cutoff = new Date(Date.now() - config.SCAN_INTERVAL_SECONDS * MISSED_SCANS_BEFORE_OFFLINE * 1000)

  const staleDevices = await deviceRepo.findOnlineLastSeenBefore(cutoff)

  for (const device of staleDevices) {
    await deviceRepo.updateStatus(device.id, 'offline')

    const deviceAlerts = await alertRepo.getActiveAlertsForDevice(device.id)
    for (const alert of deviceAlerts) {
      if (alert.alertType === 'device_offline') {
        await createAlertNotification(alert, device, 'Device offline', `Device ${device.deviceName || device.macAddress} has gone offline`, 'medium')
      }
    }

    const globalOfflineAlerts = await alertRepo.getActiveGlobalAlerts('device_offline')
    for (const alert of globalOfflineAlerts) {
      await createAlertNotification(alert, device, 'Device offline', `Device ${device.deviceName || device.macAddress} has gone offline`, 'medium')
    }
  }
}

export async function evaluateUnknownDeviceAlert(device: Device): Promise<void> {
  const globalUnknownAlerts = await alertRepo.getActiveGlobalAlerts('unknown_device')

  for (const alert of globalUnknownAlerts) {
    await createAlertNotification(alert, device, 'Unknown device detected', `New device ${device.macAddress} (${device.ipAddress}) joined the network`, 'high')
  }
}

export async function evaluateBandwidthAlerts(device: EnrichedDevice): Promise<void> {
  if (!device.network) return

  const deviceAlerts = await alertRepo.getActiveAlertsForDevice(device.device.id)

  for (const alert of deviceAlerts) {
    if (alert.alertType === 'bandwidth_exceeded' && alert.threshold) {
      const totalMbps = device.network.downloadMbps + device.network.uploadMbps
      if (totalMbps > alert.threshold) {
        await createAlertNotification(
          alert,
          device,
          'Bandwidth threshold exceeded',
          `Device ${device.device.deviceName || device.device.macAddress} exceeded ${alert.threshold} Mbps (current: ${totalMbps.toFixed(1)} Mbps)`,
          'high'
        )
      }
    }
  }
}

export async function evaluateDeviceOnlineAlert(device: Device): Promise<void> {
  // Device online alerts are not in the AlertType; only offline alerts are configured
  // This function is a placeholder for future enhancement
}

async function createAlertNotification(
  alert: DeviceAlertRule,
  device: Device | EnrichedDevice,
  title: string,
  message: string,
  priority: 'low' | 'medium' | 'high' | 'critical'
): Promise<void> {
  const deviceId = 'device' in device ? device.device.id : device.id
  const macAddress = 'device' in device ? device.device.macAddress : device.macAddress
  const ipAddress = 'device' in device ? device.device.ipAddress : device.ipAddress

  const notification = await alertRepo.createNotification({
    userId: alert.userId,
    deviceId,
    alertId: alert.id,
    title,
    message,
    type: alert.alertType,
    priority,
    data: JSON.stringify({ deviceId, macAddress, ipAddress }),
  })

  await alertRepo.triggerAlert(alert.id)

  const event: AlertRaisedEvent = {
    type: 'alert.raised',
    timestamp: new Date().toISOString(),
    userId: alert.userId,
    payload: {
      alertId: alert.id,
      deviceId,
      alertType: alert.alertType,
      message: notification.message,
      priority,
    },
  }

  eventBusInstance.emit(event)
  logger.info({ alertId: alert.id, deviceId, userId: alert.userId }, 'Alert raised')
}

export async function processScanResults(devices: Array<{ id: string; macAddress: string; ipAddress: string; hostname?: string }>): Promise<void> {
  for (const scanned of devices) {
    const existing = await deviceRepo.findByMac(scanned.macAddress)
    if (!existing) {
      const newDevice = await deviceService.upsertFromScan({
        macAddress: scanned.macAddress,
        ipAddress: scanned.ipAddress,
        hostname: scanned.hostname ?? null,
        manufacturer: null,
      })
      if (newDevice) {
        await evaluateUnknownDeviceAlert(newDevice)
      }
    } else {
      await deviceService.updateFromScan(existing.id, scanned.ipAddress, scanned.hostname ?? null)
      if (existing.status === 'offline') {
        const updated = await deviceRepo.findById(existing.id)
        if (updated) {
          await evaluateDeviceOnlineAlert(updated)
        }
      }
    }
  }
}

export async function getUserAlerts(userId: string): Promise<DeviceAlertRule[]> {
  return alertRepo.listAlerts(userId)
}

export async function createAlert(input: {
  userId: string
  deviceId: string | null
  alertType: string
  threshold?: number
}): Promise<DeviceAlertRule> {
  return alertRepo.createAlert({
    userId: input.userId,
    deviceId: input.deviceId,
    alertType: input.alertType,
    threshold: input.threshold ?? null,
  })
}

export async function updateAlert(id: string, userId: string, patch: Partial<DeviceAlertRule>): Promise<DeviceAlertRule | null> {
  return alertRepo.updateAlert(id, userId, patch)
}

export async function deleteAlert(id: string, userId: string): Promise<boolean> {
  return alertRepo.deleteAlert(id, userId)
}

export async function getUserNotifications(userId: string, options?: { unreadOnly?: boolean; limit?: number }): Promise<Notification[]> {
  return alertRepo.listNotifications(userId, options)
}

export async function markNotificationRead(id: string, userId: string): Promise<void> {
  return alertRepo.markNotificationRead(id, userId)
}