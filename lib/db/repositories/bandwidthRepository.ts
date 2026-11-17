import { randomUUID } from 'node:crypto'
import { db } from '../client'
import { sql, type Selectable } from 'kysely'
import type { BandwidthMetric, DeviceNetworkStats } from '@/lib/types'
import type { BandwidthMetricsTable } from '../schema'
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
 *
 * The shape matters more than it looks. This runs on every dashboard render and
 * on every SSE-triggered refetch, so it is the query most likely to make the UI
 * feel slow.
 */
export async function fetchStatsForDevices(
  deviceIds: string[]
): Promise<Map<string, DeviceNetworkStats>> {
  const stats = new Map<string, DeviceNetworkStats>()
  if (deviceIds.length === 0) return stats

  // One `order by ... limit 1` branch per device, unioned into a single round
  // trip. Each branch is a backward walk of `idx_bm_device_time`
  // (device_id, timestamp) that stops after one row, so it costs one index seek
  // per device and never touches the history it skips.
  //
  // Two other shapes were measured and rejected on the 100-device, 30-day
  // dataset. A `max(timestamp)` derived table joined back to
  // `bandwidth_metrics` took 4.3ms on MySQL but 1.40s on MariaDB, which
  // materialises the derived table and re-scans the base table to join against
  // it. `row_number() over (partition by device_id ...)` removes the join but
  // ranks every row before discarding all but one: 1.72s MySQL, 1.54s MariaDB.
  const latestPerDevice = deviceIds.map(
    (id) => sql`
      (select device_id, timestamp, upload_speed, download_speed,
              upload_total, download_total
         from bandwidth_metrics
        where device_id = ${id}
        order by timestamp desc
        limit 1)`
  )

  const { rows } = await sql<
    Pick<
      Selectable<BandwidthMetricsTable>,
      | 'device_id'
      | 'timestamp'
      | 'upload_speed'
      | 'download_speed'
      | 'upload_total'
      | 'download_total'
    >
  >`${sql.join(latestPerDevice, sql` union all `)}`.execute(db)

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

/**
 * Peak throughput per calendar day for a device over the last `days` days.
 * Groups samples by date and takes the max download/upload per day.
 */
export async function peakPerDay(
  deviceId: string,
  days: number
): Promise<Array<{ date: string; peakUploadMbps: number; peakDownloadMbps: number }>> {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const from = new Date(now)
  from.setDate(from.getDate() - days + 1)

  const rows = await listForDeviceBetween(deviceId, from, now)

  const byDay = new Map<
    string,
    { peakUpload: number; peakDownload: number }
  >()
  for (const row of rows) {
    const date = new Date(row.timestamp).toISOString().slice(0, 10)
    const existing = byDay.get(date) ?? { peakUpload: 0, peakDownload: 0 }
    existing.peakUpload = Math.max(existing.peakUpload, row.uploadSpeed)
    existing.peakDownload = Math.max(existing.peakDownload, row.downloadSpeed)
    byDay.set(date, existing)
  }

  // Ensure every day in the range is represented (zeros when no samples).
  const result: Array<{ date: string; peakUploadMbps: number; peakDownloadMbps: number }> = []
  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const date = d.toISOString().slice(0, 10)
    const peak = byDay.get(date) ?? { peakUpload: 0, peakDownload: 0 }
    result.push({ date, peakUploadMbps: peak.peakUpload, peakDownloadMbps: peak.peakDownload })
  }
  return result.reverse()
}