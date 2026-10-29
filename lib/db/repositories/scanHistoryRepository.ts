import { randomUUID } from 'node:crypto'
import { db } from '../client'

/**
 * `network_scan_history` — the per-scan audit trail.
 *
 * The insert used to live inline in `scanJob.recordScanHistory`, wrapped in a
 * swallow-everything catch. It moves here so the daily summary can read the
 * same table it writes, and so the "history is observability, not function"
 * policy lives with the code that owns the trade-off (`scanJob` still holds
 * the try/catch — a history failure must never fail a scan).
 *
 * `created_at` is a `varchar(64)` holding an ISO-8601 UTC string, as every
 * writer in this codebase uses. ISO strings sort lexicographically in UTC
 * order, so a range filter is a plain string `>=` comparison — no date
 * parsing, and the existing `idx_nsh_created` index applies directly.
 */

export interface ScanHistoryInput {
  scannerName: string
  durationMs: number
  deviceCount: number
  successCount: number
  failureCount: number
  status: string
  errorMessage: string | null
}

/** A 24h rollup of scan runs, for the daily admin summary. */
export interface ScanSummary {
  totalScans: number
  successCount: number
  partialCount: number
  failedCount: number
  maxDevicesSeen: number
  avgDurationMs: number
  /** The scanner that produced these rows, for the summary's wording. */
  scannerName: string | null
}

export async function insertScanHistory(input: ScanHistoryInput): Promise<void> {
  await db
    .insertInto('network_scan_history')
    .values({
      id: randomUUID(),
      scanner_name: input.scannerName,
      scan_duration: input.durationMs,
      device_count: input.deviceCount,
      success_count: input.successCount,
      failure_count: input.failureCount,
      status: input.status,
      error_message: input.errorMessage,
      created_at: new Date().toISOString(),
    })
    .execute()
}

/**
 * Aggregates the last `windowHours` hours of scan runs.
 *
 * `status` is a free string column written as 'success' | 'partial' (and the
 * summary counts a scan that threw as 'failed' only when a history row
 * exists with that status — a scanner that throws outright writes no row, so
 * the "failed" count here can under-report; the immediate `scan.completed`
 * event covers that case in real time, and this rollup is the daily picture).
 */
export async function aggregateLast24Hours(now = new Date()): Promise<ScanSummary> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  const rows = await db
    .selectFrom('network_scan_history')
    .select([
      'status',
      'scan_duration',
      'device_count',
      'scanner_name',
      'created_at',
    ])
    .where('created_at', '>=', cutoff)
    .execute()

  if (rows.length === 0) {
    return {
      totalScans: 0,
      successCount: 0,
      partialCount: 0,
      failedCount: 0,
      maxDevicesSeen: 0,
      avgDurationMs: 0,
      scannerName: null,
    }
  }

  let successCount = 0
  let partialCount = 0
  let failedCount = 0
  let maxDevicesSeen = 0
  let durationTotal = 0

  for (const row of rows) {
    if (row.status === 'success') successCount += 1
    else if (row.status === 'partial') partialCount += 1
    else failedCount += 1

    if (row.device_count > maxDevicesSeen) maxDevicesSeen = row.device_count
    durationTotal += row.scan_duration
  }

  return {
    totalScans: rows.length,
    successCount,
    partialCount,
    failedCount,
    maxDevicesSeen,
    avgDurationMs: Math.round(durationTotal / rows.length),
    // All rows share a scanner in practice; the first is enough for wording.
    scannerName: rows[0]?.scanner_name ?? null,
  }
}
