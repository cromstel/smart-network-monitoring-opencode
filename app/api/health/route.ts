import { NextResponse } from 'next/server'
import { sql } from 'kysely'
import { db } from '@/lib/db/client'
import { getConfig } from '@/lib/config'
import { apiError } from '@/lib/api/errors'
import pkg from '../../../package.json'

export async function GET() {
  let databaseConnected = true
  try {
    await sql`SELECT 1`.execute(db)
  } catch {
    databaseConnected = false
  }

  const config = getConfig()

  const payload = {
    status: databaseConnected ? 'ok' : 'degraded',
    version: pkg.version,
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      client: config.DB_CLIENT,
      connected: databaseConnected,
    },
    scanner: {
      mode: config.SCANNER_MODE,
      lastScanAt: null,
      healthy: config.SCANNER_MODE === 'simulated',
    },
  }

  if (!databaseConnected) {
    return NextResponse.json(payload, { status: 503 })
  }

  return NextResponse.json(payload)
}

export function POST(): NextResponse {
  return apiError(405, 'INVALID_QUERY', 'Method not allowed.')
}