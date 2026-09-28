import { randomUUID } from 'node:crypto'
import { db } from '../client'
import { sql } from 'kysely'
import type { BandwidthMetric, DeviceNetworkStats } from '@/lib/types'
import { rowToBandwidthMetric } from './mappers'

export interface BandwidthSampleInput {
  deviceId: string
  timestamp: Date
  uploadSpeed: number
  downloadSpeed: number
  uploadTotal: string
  downloadTotal: string
}

export async function insertBandwidthMetric(
  input: BandwidthSampleInput
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .insertInto('bandwidth_metrics')
    .values({
      id: randomUUID(),
      device_id: input.deviceId,
      timestamp: input.timestamp.toISOString(),
      upload_speed: input.uploadSpeed,
      download_speed: input.downloadSpeed,
      upload_total: input.uploadTotal,
      download_total: input.downloadTotal,
      created_at: now,
    })
    .execute()
}

export async function findLatestForDevice(
  deviceId: string
): Promise<BandwidthMetric | null> {
  const row = await db
    .selectFrom('bandwidth_metrics')
    .selectAll()
    .where('device_id', '=', deviceId)
    .orderBy('timestamp', 'desc')
    .limit(1)
    .executeTakeFirst()

  return row ? rowToBandwidthMetric(row) : null
}

export async function listForDeviceBetween(
  deviceId: string,
  from: Date,
  to: Date
): Promise<BandwidthMetric[]> {
  const rows = await db
    .selectFrom('bandwidth_metrics')
    .selectAll()
    .where('device_id', '=', deviceId)
    .where('timestamp', '>=', from.toISOString())
    .where('timestamp', '<=', to.toISOString())
    .orderBy('timestamp', 'asc')
    .execute()

  return rows.map(rowToBandwidthMetric)
}

/**
 * Latest network stats per device, one query for the whole batch.
 * The max(timestamp) subquery keeps the join dialect-safe (MySQL and SQLite).
 */
export async function fetchStatsForDevices(
  deviceIds: string[]
): Promise<Map<string, DeviceNetworkStats>> {
  const stats = new Map<string, DeviceNetworkStats>()
  if (deviceIds.length === 0) return stats

  const latest = db
    .selectFrom('bandwidth_metrics')
    .select(['device_id', db.fn.max<string>('timestamp').as('ts')])
    .where('device_id', 'in', deviceIds)
    .groupBy('device_id')
    .as('latest')

  const rows = await db
    .selectFrom('bandwidth_metrics as bm')
    .innerJoin(latest, (jb) =>
      jb
        .onRef('bm.device_id', '=', 'latest.device_id')
        .onRef('bm.timestamp', '=', 'latest.ts')
    )
    .select([
      'bm.device_id',
      'bm.timestamp',
      'bm.upload_speed',
      'bm.download_speed',
      'bm.upload_total',
      'bm.download_total',
    ])
    .execute()

  for (const row of rows) {
    stats.set(row.device_id, {
      lastSeenAt: new Date(row.timestamp),
      uploadMbps: row.upload_speed,
      downloadMbps: row.download_speed,
      uploadBytes: String(row.upload_total),
      downloadBytes: String(row.download_total),
    })
  }
  return stats
}

/**
 * Current network-wide totals from the latest sample per device.
 */
export async function fetchNetworkTotals(): Promise<{
  totalDevices: number
  onlineDevices: number
  totalUploadMbps: number
  totalDownloadMbps: number
}> {
  const totalDevicesResult = await db
    .selectFrom('devices')
    .select(db.fn.count<number>('id').as('count'))
    .executeTakeFirst()

  const onlineDevicesResult = await db
    .selectFrom('devices')
    .select(db.fn.count<number>('id').as('count'))
    .where('status', '=', 'online')
    .executeTakeFirst()

  // Sum of latest upload/download speeds per device
  const latest = db
    .selectFrom('bandwidth_metrics')
    .select(['device_id', db.fn.max<string>('timestamp').as('ts')])
    .groupBy('device_id')
    .as('latest')

  const totals = await db
    .selectFrom('bandwidth_metrics as bm')
    .innerJoin(latest, (jb) =>
      jb
        .onRef('bm.device_id', '=', 'latest.device_id')
        .onRef('bm.timestamp', '=', 'latest.ts')
    )
    .select([
      db.fn.sum<number>(sql`bm.upload_speed`).as('totalUpload'),
      db.fn.sum<number>(sql`bm.download_speed`).as('totalDownload'),
    ])
    .executeTakeFirst()

  return {
    totalDevices: Number(totalDevicesResult?.count ?? 0),
    onlineDevices: Number(onlineDevicesResult?.count ?? 0),
    totalUploadMbps: Number(totals?.totalUpload ?? 0),
    totalDownloadMbps: Number(totals?.totalDownload ?? 0),
  }
}

/**
 * Peak throughput for today (sum of per-device peaks from bandwidth_hourly).
 */
export async function fetchTodayPeak(): Promise<{
  peakUploadMbps: number
  peakDownloadMbps: number
}> {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const peak = await db
    .selectFrom('bandwidth_hourly')
    .select([
      db.fn.sum<number>(sql`peak_upload_speed`).as('peakUpload'),
      db.fn.sum<number>(sql`peak_download_speed`).as('peakDownload'),
    ])
    .where('hour_start', '>=', todayStart.toISOString())
    .executeTakeFirst()

  return {
    peakUploadMbps: Number(peak?.peakUpload ?? 0),
    peakDownloadMbps: Number(peak?.peakDownload ?? 0),
  }
}

/**
 * Top N bandwidth consumers by current total throughput (upload + download).
 */
export async function fetchTopConsumers(
  limit: number = 5
): Promise<Array<{
  deviceId: string
  deviceName: string | null
  macAddress: string
  ipAddress: string
  totalMbps: number
  uploadMbps: number
  downloadMbps: number
}>> {
  if (limit <= 0) return []

  const latest = db
    .selectFrom('bandwidth_metrics')
    .select(['device_id', db.fn.max<string>('timestamp').as('ts')])
    .groupBy('device_id')
    .as('latest')

  const rows = await db
    .selectFrom('bandwidth_metrics as bm')
    .innerJoin(latest, (jb) =>
      jb
        .onRef('bm.device_id', '=', 'latest.device_id')
        .onRef('bm.timestamp', '=', 'latest.ts')
    )
    .innerJoin('devices as d', 'd.id', 'bm.device_id')
    .select([
      'bm.device_id',
      'd.device_name',
      'd.mac_address',
      'd.ip_address',
      'bm.upload_speed',
      'bm.download_speed',
    ])
    .orderBy(sql`bm.upload_speed + bm.download_speed`, 'desc')
    .limit(limit)
    .execute()

  return rows.map((row) => ({
    deviceId: row.device_id,
    deviceName: row.device_name,
    macAddress: row.mac_address,
    ipAddress: row.ip_address,
    uploadMbps: Number(row.upload_speed ?? 0),
    downloadMbps: Number(row.download_speed ?? 0),
    totalMbps: Number((row.upload_speed ?? 0) + (row.download_speed ?? 0)),
  }))
}