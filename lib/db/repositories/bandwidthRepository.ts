import { randomUUID } from 'node:crypto'
import { db } from '../client'
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