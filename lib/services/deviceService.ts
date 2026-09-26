import * as deviceRepo from '@/lib/db/repositories/deviceRepository'
import * as bandwidthRepo from '@/lib/db/repositories/bandwidthRepository'
import * as connectionLogRepo from '@/lib/db/repositories/connectionLogRepository'
import type {
  Device,
  DeviceFilters,
  EnrichedDevice,
  Pagination,
} from '@/lib/types'

const MISSED_SCANS_BEFORE_OFFLINE = 2

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

export async function markStaleDevicesOffline(scanIntervalSeconds: number): Promise<Device[]> {
  const cutoff = new Date(
    Date.now() - scanIntervalSeconds * MISSED_SCANS_BEFORE_OFFLINE * 1000
  )
  const stale = await deviceRepo.findOnlineLastSeenBefore(cutoff)

  for (const device of stale) {
    await deviceRepo.updateStatus(device.id, 'offline')
    await connectionLogRepo.insert({
      deviceId: device.id,
      eventType: 'disconnected',
      timestamp: new Date(),
      connectionDuration: Math.max(
        0,
        Math.floor((Date.now() - device.lastSeen.getTime()) / 1000)
      ),
    })
  }
  return stale
}

export async function upsertFromScan(input: deviceRepo.ScanDeviceInput): Promise<Device | null> {
  await deviceRepo.upsertFromScan(input)
  return deviceRepo.findByMac(input.macAddress)
}

export async function updateFromScan(id: string, ipAddress: string, hostname: string | null): Promise<void> {
  await deviceRepo.updateFromScan(id, ipAddress, hostname)
}