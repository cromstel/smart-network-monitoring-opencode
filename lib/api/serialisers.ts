import type { EnrichedDevice } from '@/lib/types'

export interface DeviceDTO {
  id: string
  macAddress: string
  ipAddress: string
  hostname: string | null
  deviceName: string | null
  deviceType: EnrichedDevice['device']['deviceType']
  manufacturer: string | null
  status: EnrichedDevice['device']['status']
  signalStrength: number | null
  firstSeen: string
  lastSeen: string
  totalConnectionTimeSeconds: number
  isBlocked: boolean
  currentBandwidth: {
    uploadMbps: number
    downloadMbps: number
  }
  totalTransferred: {
    uploadBytes: string
    downloadBytes: string
  }
}

/**
 * SERIALISATION CONTRACT: byte counters are strings. They exceed
 * Number.MAX_SAFE_INTEGER and JSON.stringify throws on a JS bigint
 * (AUDIT.md A-05). Never coerce them to number here.
 */
export function toDeviceDTO(enriched: EnrichedDevice): DeviceDTO {
  const { device, network } = enriched
  return {
    id: device.id,
    macAddress: device.macAddress,
    ipAddress: device.ipAddress,
    hostname: device.hostname,
    deviceName: device.deviceName,
    deviceType: device.deviceType,
    manufacturer: device.manufacturer,
    status: device.status,
    signalStrength: device.signalStrength,
    firstSeen: device.firstSeen.toISOString(),
    lastSeen: device.lastSeen.toISOString(),
    totalConnectionTimeSeconds: device.totalConnectionTimeSeconds,
    isBlocked: device.isBlocked,
    currentBandwidth: {
      uploadMbps: network?.uploadMbps ?? 0,
      downloadMbps: network?.downloadMbps ?? 0,
    },
    totalTransferred: {
      uploadBytes: network?.uploadBytes ?? '0',
      downloadBytes: network?.downloadBytes ?? '0',
    },
  }
}