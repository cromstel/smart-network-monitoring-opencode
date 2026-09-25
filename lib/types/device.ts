import type { DeviceNetworkStats } from './bandwidth'

export type DeviceStatus = 'online' | 'offline' | 'idle'

export type DeviceType =
  | 'phone'
  | 'tablet'
  | 'laptop'
  | 'desktop'
  | 'tv'
  | 'speaker'
  | 'printer'
  | 'camera'
  | 'server'
  | 'switch'
  | 'router'
  | 'iot'
  | 'unknown'

export const KNOWN_DEVICE_TYPES: readonly DeviceType[] = [
  'phone', 'tablet', 'laptop', 'desktop', 'tv', 'speaker',
  'printer', 'camera', 'server', 'switch', 'router', 'iot', 'unknown',
]

export function isDeviceType(value: string): value is DeviceType {
  return (KNOWN_DEVICE_TYPES as readonly string[]).includes(value)
}

export interface Device {
  id: string
  macAddress: string
  ipAddress: string
  hostname: string | null
  deviceName: string | null
  deviceType: DeviceType
  manufacturer: string | null
  signalStrength: number | null
  status: DeviceStatus
  isBlocked: boolean
  isIgnored: boolean
  totalConnectionTimeSeconds: number
  categoryId: string | null
  firstSeen: Date
  lastSeen: Date
  createdAt: Date
  updatedAt: Date
}

export type DeviceSortField = 'name' | 'lastSeen' | 'bandwidth'

export interface DeviceFilters {
  status?: DeviceStatus
  type?: string
  search?: string
  categoryId?: string
  sort?: DeviceSortField
  order?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface Pagination {
  page: number
  pageSize: number
  total: number
}

export interface DeviceListResult {
  data: Device[]
  pagination: Pagination
}

/**
 * A device decorated with its latest network stats for API serialisation.
 * `network` is null when the device has no bandwidth samples yet.
 */
export interface EnrichedDevice {
  device: Device
  network: DeviceNetworkStats | null
}