import { db } from '@/lib/db/client'
import { getEffectiveRetentionSettings } from '@/lib/services/runtimeSettings'
import { logger } from '@/lib/utils/logger'

const BATCH_SIZE = 10_000
const PAUSE_MS = 100

async function deleteInBatches(
  table: 'bandwidth_metrics' | 'connection_logs' | 'notifications' | 'network_scan_history' | 'sessions',
  where: (eb: any) => any
): Promise<number> {
  let totalDeleted = 0
  while (true) {
    const result = await db
      .deleteFrom(table)
      .where(where)
      .limit(BATCH_SIZE)
      .executeTakeFirst()
    const deleted = Number(result?.numDeletedRows ?? 0)
    totalDeleted += deleted
    if (deleted < BATCH_SIZE) break
    await new Promise((r) => setTimeout(r, PAUSE_MS))
  }
  return totalDeleted
}

export async function pruneData(): Promise<{
  bandwidthMetrics: number
  connectionLogs: number
  notifications: number
  scanHistory: number
  sessions: number
}> {
  // F-51: retention is a saved setting, not only an env default. Reading the
  // effective value is what makes the "Retention (days)" field on the settings
  // page actually control how long history survives.
  const { dataRetentionDays } = await getEffectiveRetentionSettings()
  const retentionMs = dataRetentionDays * 24 * 60 * 60 * 1000
  const cutoff = new Date(Date.now() - retentionMs)
  const scanCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const now = new Date()

  logger.info(
    { retentionDays: dataRetentionDays, cutoff: cutoff.toISOString() },
    'starting data pruning'
  )

  const bandwidthMetrics = await deleteInBatches('bandwidth_metrics', (eb) =>
    eb('timestamp', '<', cutoff.toISOString())
  )

  const connectionLogs = await deleteInBatches('connection_logs', (eb) =>
    eb('timestamp', '<', cutoff.toISOString())
  )

  const notifications = await deleteInBatches('notifications', (eb) =>
    eb('created_at', '<', cutoff.toISOString())
  )

  const scanHistory = await deleteInBatches('network_scan_history', (eb) =>
    eb('created_at', '<', scanCutoff.toISOString())
  )

  const sessions = await deleteInBatches('sessions', (eb) =>
    eb('expires_at', '<', now.toISOString())
  )

  logger.info(
    { bandwidthMetrics, connectionLogs, notifications, scanHistory, sessions },
    'data pruning completed'
  )

  return { bandwidthMetrics, connectionLogs, notifications, scanHistory, sessions }
}