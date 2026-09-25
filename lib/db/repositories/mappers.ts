import type { Selectable } from 'kysely'
import type {
  BandwidthMetricsTable,
  ConnectionLogsTable,
  DevicesTable,
} from '../schema'
import type {
  BandwidthMetric,
  ConnectionLog,
  Device,
  DeviceStatus,
  DeviceType,
} from '@/lib/types'
import { isDeviceType } from '@/lib/types'

const DEVICE_STATUSES: readonly DeviceStatus[] = ['online', 'offline', 'idle']

function toDate(value: string | Date | null): Date | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value : new Date(value)
}

function toBool(value: number | bigint): boolean {
  return Number(value) === 1
}

function toNullableNumber(value: number | bigint | null): number | null {
  return value === null || value === undefined ? null : Number(value)
}

function toByteString(value: string | number | bigint): string {
  return String(value)
}

function toStatus(value: string): DeviceStatus {
  if ((DEVICE_STATUSES as readonly string[]).includes(value)) {
    return value as DeviceStatus
  }
  return 'offline'
}

function toDeviceType(value: string): DeviceType {
  return isDeviceType(value) ? value : 'unknown'
}

export function rowToDevice(row: Selectable<DevicesTable>): Device {
  return {
    id: row.id,
    macAddress: row.mac_address,
    ipAddress: row.ip_address,
    hostname: row.hostname,
    deviceName: row.device_name,
    deviceType: toDeviceType(row.device_type),
    manufacturer: row.manufacturer,
    signalStrength: toNullableNumber(row.signal_strength),
    status: toStatus(row.status),
    isBlocked: toBool(row.is_blocked),
    isIgnored: toBool(row.is_ignored),
    totalConnectionTimeSeconds: Number(row.total_connection_time),
    categoryId: row.category_id,
    firstSeen: toDate(row.first_seen) as Date,
    lastSeen: toDate(row.last_seen) as Date,
    createdAt: toDate(row.created_at) as Date,
    updatedAt: toDate(row.updated_at) as Date,
  }
}

export function rowToBandwidthMetric(row: Selectable<BandwidthMetricsTable>): BandwidthMetric {
  return {
    id: row.id,
    deviceId: row.device_id,
    timestamp: toDate(row.timestamp) as Date,
    uploadSpeed: row.upload_speed,
    downloadSpeed: row.download_speed,
    uploadTotal: toByteString(row.upload_total),
    downloadTotal: toByteString(row.download_total),
    createdAt: toDate(row.created_at) as Date,
  }
}

export function rowToConnectionLog(row: Selectable<ConnectionLogsTable>): ConnectionLog {
  return {
    id: row.id,
    deviceId: row.device_id,
    eventType: row.event_type === 'connected' ? 'connected' : 'disconnected',
    timestamp: toDate(row.timestamp) as Date,
    ipAddress: row.ip_address,
    connectionDuration: toNullableNumber(row.connection_duration),
    createdAt: toDate(row.created_at) as Date,
  }
}