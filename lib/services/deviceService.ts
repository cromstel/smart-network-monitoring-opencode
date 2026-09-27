import * as deviceRepo from '@/lib/db/repositories/deviceRepository'
import * as bandwidthRepo from '@/lib/db/repositories/bandwidthRepository'
import * as connectionLogRepo from '@/lib/db/repositories/connectionLogRepository'
import { eventBusInstance } from '@/lib/services/eventBus'
import type { Device, DeviceFilters, EnrichedDevice, Pagination } from '@/lib/types'

/**
 * F-06: a device is offline after two consecutive missed scans. This module
 * owns that transition — status, connection log, and the SSE event — so there
 * is exactly one place that can decide a device went away. Raising the
 * matching alert is a separate, explicit step in `scanJob` (see
 * `alertService.evaluateDeviceOffline`) rather than a hidden side effect here.
 */

const MISSED_SCANS_BEFORE_OFFLINE = 2

export const OFFLINE_AFTER_MISSED_SCANS = MISSED_SCANS_BEFORE_OFFLINE

interface EnrichedListResult {
  data: EnrichedDevice[]
  pagination: Pagination
}

async function enrich(devices: Device[]): Promise<EnrichedDevice[]> {
  const stats = await bandwidthRepo.fetchStatsForDevices(devices.map((d) => d.id))
  return devices.map((device) => ({
    device,
    network: stats.get(device.id) ?? null,
  }))
}

export async function listDevices(filters: DeviceFilters = {}): Promise<EnrichedListResult> {
  const result = await deviceRepo.listDevices(filters)
  return {
    data: await enrich(result.data),
    pagination: result.pagination,
  }
}

export async function getDeviceById(id: string): Promise<EnrichedDevice | null> {
  const device = await deviceRepo.findById(id)
  if (!device) return null
  const enriched = await enrich([device])
  return enriched[0]
}

export async function updateDeviceById(
  id: string,
  patch: deviceRepo.DevicePatch
): Promise<Device | null> {
  return deviceRepo.update(id, patch)
}

/**
 * Flips stale devices to offline, records how long they were connected, and
 * publishes `device.disconnected`. Returns the devices that changed state.
 */
export async function markStaleDevicesOffline(scanIntervalSeconds: number): Promise<Device[]> {
  const cutoff = new Date(
    Date.now() - scanIntervalSeconds * MISSED_SCANS_BEFORE_OFFLINE * 1000
  )
  const stale = await deviceRepo.findOnlineLastSeenBefore(cutoff)

  for (const device of stale) {
    const connectionDuration = Math.max(
      0,
      Math.floor((Date.now() - device.lastSeen.getTime()) / 1000)
    )

    await deviceRepo.updateStatus(device.id, 'offline')
    await connectionLogRepo.insert({
      deviceId: device.id,
      eventType: 'disconnected',
      timestamp: new Date(),
      ipAddress: device.ipAddress,
      connectionDuration,
    })

    eventBusInstance.emit({
      type: 'device.disconnected',
      timestamp: new Date().toISOString(),
      payload: {
        deviceId: device.id,
        macAddress: device.macAddress,
        connectionDuration,
      },
    })
  }

  return stale
}

export async function upsertFromScan(input: deviceRepo.ScanDeviceInput): Promise<Device | null> {
  await deviceRepo.upsertFromScan(input)
  return deviceRepo.findByMac(input.macAddress)
}

export async function updateFromScan(
  id: string,
  ipAddress: string,
  hostname: string | null
): Promise<void> {
  await deviceRepo.updateFromScan(id, ipAddress, hostname)
}
