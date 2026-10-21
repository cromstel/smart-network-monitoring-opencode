import { NextResponse } from 'next/server'
import { sql } from 'kysely'
import { db } from '@/lib/db/client'
import { getConfig } from '@/lib/config'
import { apiError } from '@/lib/api/errors'
import { getSchedulerStatus } from '@/instrumentation.node'
import { logger } from '@/lib/utils/logger'
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
 *
 * ## What this endpoint deliberately does not say
 *
 * It is public: `proxy.ts` lists it among the unauthenticated paths, and the
 * container healthcheck has no cookie to send. It therefore answers with
 * health, never with detail:
 *
 *   - **No scan error text.** `error_message` rows quote what the scanner
 *     observed — device IPs, hostnames, command output — which an
 *     unauthenticated caller has no business learning. The status enum tells
 *     "degraded" from "down"; the text stays in the database, readable from
 *     the authenticated scan pages.
 *   - **A bad configuration is a 503, not a 500.** An invalid environment
 *     used to bubble out of `getConfig()` as an unhandled throw, so the
 *     healthcheck saw a 500 — indistinguishable from a crash, and in a dev
 *     build carrying a stack trace. The error is logged server-side; the
 *     response carries a generic reason an operator can grep for.
 */
export async function GET() {
  let config: ReturnType<typeof getConfig>
  try {
    config = getConfig()
  } catch (error) {
    logger.error({ err: error }, 'health check: configuration is invalid')
    return NextResponse.json(
      {
        status: 'unhealthy',
        version: pkg.version,
        uptimeSeconds: Math.floor(process.uptime()),
        database: { connected: false },
        reason: 'invalid-configuration',
      },
      { status: 503 }
    )
  }

  let databaseConnected = true
  try {
    await sql`SELECT 1`.execute(db)
  } catch {
    databaseConnected = false
  }

  let lastScanAt: string | null = null
  let lastScanStatus: string | null = null
  let consecutiveFailures = 0

  if (databaseConnected) {
    try {
      const recent = await db
        .selectFrom('network_scan_history')
        .orderBy('created_at', 'desc')
        .limit(5)
        // `error_message` is deliberately absent: see the note above.
        .select(['created_at', 'status'])
        .execute()

      const latest = recent[0]
      if (latest) {
        lastScanAt = latest.created_at
        lastScanStatus = latest.status
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
