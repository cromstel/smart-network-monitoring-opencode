import { NextResponse } from 'next/server'
import { sql } from 'kysely'
import { db } from '@/lib/db/client'
import { getConfig } from '@/lib/config'
import { apiError } from '@/lib/api/errors'
import { getSchedulerStatus } from '@/instrumentation'
import pkg from '../../../package.json'

export const dynamic = 'force-dynamic'

/**
 * Liveness plus a real picture of the last scan.
 *
 * The previous version hard-coded `lastScanAt: null` and derived
 * `scanner.healthy` from `SCANNER_MODE === 'simulated'`, which reported a
 * healthy scanner while an ARP scan had been failing for an hour. It now
 * reads the most recent row from `network_scan_history` — the scheduler writes
 * one per cycle — so the number is either real or explicitly unknown.
 */
export async function GET() {
  let databaseConnected = true
  try {
    await sql`SELECT 1`.execute(db)
  } catch {
    databaseConnected = false
  }

  const config = getConfig()

  let lastScanAt: string | null = null
  let lastScanStatus: string | null = null
  let lastScanError: string | null = null
  let consecutiveFailures = 0

  if (databaseConnected) {
    try {
      const recent = await db
        .selectFrom('network_scan_history')
        .orderBy('created_at', 'desc')
        .limit(5)
        .select(['created_at', 'status', 'error_message'])
        .execute()

      const latest = recent[0]
      if (latest) {
        lastScanAt = latest.created_at
        lastScanStatus = latest.status
        lastScanError = latest.error_message
        consecutiveFailures = recent.filter((r) => r.status !== 'success').length
      }
    } catch {
      consecutiveFailures = -1 // unknown
    }
  }

  const scheduler = getSchedulerStatus()
  const scannerHealthy = lastScanStatus === 'success' || lastScanStatus === null

  const payload = {
    status: databaseConnected ? (scannerHealthy ? 'ok' : 'degraded') : 'unhealthy',
    version: pkg.version,
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      client: config.DB_CLIENT,
      connected: databaseConnected,
    },
    scanner: {
      mode: config.SCANNER_MODE,
      lastScanAt,
      lastScanStatus,
      lastScanError,
      consecutiveFailures,
      healthy: scannerHealthy,
    },
    scheduler,
  }

  if (!databaseConnected) {
    return NextResponse.json(payload, { status: 503 })
  }
  if (!scannerHealthy) {
    return NextResponse.json(payload, { status: 200 })
  }

  return NextResponse.json(payload)
}

export function POST(): NextResponse {
  return apiError(405, 'INVALID_QUERY', 'Method not allowed.')
}
