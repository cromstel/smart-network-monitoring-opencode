/**
 * Generates a realistic dataset for the performance harness.
 *
 * Sized to the PRD §5 target of 100 concurrent devices with 30 days of
 * history, because that is the load the published numbers are about. Kept
 * separate from `scripts/seed.ts` (12 devices, a demo) and `scripts/e2e-seed.ts`
 * (5 devices, a known password) because this one exists purely to make the
 * database big enough to measure honestly.
 *
 * Refuses to touch a database that already has devices, and requires the
 * caller to name a throwaway target — a `DB_FILE` path on SQLite, a `DB_NAME`
 * schema on MySQL — so it cannot clobber real data.
 *
 * Usage:
 *   SQLite:   DB_FILE=./data/perf.db                  npm run perf:dataset
 *   MySQL:    DB_NAME=home_monitor_perf               npm run perf:dataset
 */

import { randomUUID } from 'node:crypto'
import { db } from '../lib/db/client'
import { runMigrations } from '../lib/db/migrator'
import { logger } from '../lib/utils/logger'
import type { DeviceType } from '../lib/types'

const HOUR = 3_600_000

const TYPES: DeviceType[] = [
  'phone', 'laptop', 'tv', 'tablet', 'printer', 'camera',
  'server', 'speaker', 'iot', 'desktop', 'switch', 'unknown',
]

const VENDORS = ['Apple, Inc.', 'Samsung', 'Intel Corporate', 'TP-Link', 'Sonos', 'Ubiquiti', 'Raspberry Pi']

export interface PerfDatasetOptions {
  devices: number
  historyDays: number
  /** Samples per device per day. 96 = every 15 minutes. */
  samplesPerDay: number
}

export const DEFAULT_PERF_DATASET: PerfDatasetOptions = {
  devices: 100,
  historyDays: 30,
  samplesPerDay: 96,
}

export interface PerfDatasetSummary {
  devices: number
  bandwidthRows: number
  connectionLogRows: number
  databaseFile: string
}

/**
 * Confirms the target database is a throwaway, and returns a human label for
 * it. The dataset is 288,000 rows written one device at a time — pointed at a
 * real database that is destructive, so this refuses rather than trusting the
 * caller to have been careful.
 *
 * The guard is dialect-aware because the ways of naming a throwaway differ: a
 * SQLite throwaway is a file path, a MySQL one is a schema. Requiring `DB_FILE`
 * on the MySQL path would have meant the MySQL leg could never run at all,
 * which is how it stayed unmeasured in the first place.
 */
export async function assertDisposableDatabase(): Promise<string> {
  const client = process.env.DB_CLIENT ?? 'sqlite'

  if (client === 'mysql') {
    const name = process.env.DB_NAME ?? ''
    if (!name) {
      throw new Error('DB_NAME must be set when DB_CLIENT=mysql — refusing to guess.')
    }
    // Same intent as the `dev.db` check below: a name that looks like it could
    // be the real one is refused outright.
    if (/^(home_monitor|smart_home_monitor|monitor)$/i.test(name)) {
      throw new Error(
        `Refusing to build a performance dataset in schema "${name}" — that looks like the live database. Point DB_NAME at a scratch schema.`
      )
    }
    if (!/(_test|_perf|perf_|_scratch)/i.test(name)) {
      throw new Error(
        `Refusing to build a performance dataset in schema "${name}" — the name does not look like a throwaway. Use a schema such as home_monitor_perf.`
      )
    }
    return `${process.env.DB_HOST ?? 'localhost'}:${process.env.DB_PORT ?? 3306}/${name}`
  }

  const file = process.env.DB_FILE ?? ''
  if (!file) {
    throw new Error('DB_FILE must be set (e.g. ./data/perf.db) — refusing to guess.')
  }
  if (file.includes('dev.db') && !file.includes('perf')) {
    throw new Error(`Refusing to build a performance dataset in ${file}`)
  }
  return file
}

export async function buildPerfDataset(
  options: PerfDatasetOptions = DEFAULT_PERF_DATASET
): Promise<PerfDatasetSummary> {
  const databaseFile = await assertDisposableDatabase()
  await runMigrations()

  const existing = await db.selectFrom('devices').select('id').executeTakeFirst()
  if (existing) {
    throw new Error(
      `${databaseFile} already contains devices. Delete it before building a performance dataset.`
    )
  }

  const now = Date.now()
  const firstSeen = new Date(now - (options.historyDays + 1) * 24 * HOUR).toISOString()
  const nowIso = new Date(now).toISOString()
  const adminId = randomUUID()

  await db
    .insertInto('users')
    .values({
      id: adminId,
      email: 'perf@example.com',
      // Never a valid credential: this account exists only to satisfy the
      // foreign keys on alerts and settings.
      password_hash: 'perf-only-no-login',
      name: 'Perf Harness',
      role: 'ADMIN',
      is_active: 1,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .execute()

  await db
    .insertInto('user_settings')
    .values({
      id: randomUUID(),
      user_id: adminId,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .execute()

  const deviceRows = Array.from({ length: options.devices }, (_, i) => ({
    id: randomUUID(),
    mac_address: `AA:BB:CC:${String(Math.floor(i / 65536) & 0xff).padStart(2, '0')}:${String(
      Math.floor(i / 256) & 0xff
    ).padStart(2, '0')}:${String(i & 0xff).padStart(2, '0')}`,
    ip_address: `192.168.1.${(i % 253) + 2}`,
    hostname: `device-${i}`,
    device_name: `Perf Device ${i}`,
    device_type: TYPES[i % TYPES.length]!,
    manufacturer: VENDORS[i % VENDORS.length]!,
    signal_strength: -40 - (i % 50),
    status: i % 20 === 0 ? 'offline' : 'online',
    is_blocked: 0,
    is_ignored: 0,
    total_connection_time: String((i % 500) * 3600),
    first_seen: firstSeen,
    last_seen: new Date(now - (i % 600) * 1000).toISOString(),
    created_at: firstSeen,
    updated_at: nowIso,
  }))

  for (let i = 0; i < deviceRows.length; i += 50) {
    await db.insertInto('devices').values(deviceRows.slice(i, i + 50) as never).execute()
  }

  // Bandwidth samples, oldest first, batched to stay inside SQLite's
  // variable limit.
  let bandwidthRows = 0
  const totalSamples = options.historyDays * options.samplesPerDay
  const intervalMs = (24 * HOUR) / options.samplesPerDay

  for (const device of deviceRows) {
    const rows: Array<Record<string, unknown>> = []
    let upTotal = 0
    let downTotal = 0

    for (let s = totalSamples - 1; s >= 0; s -= 1) {
      const at = now - s * intervalMs
      upTotal += 50_000 + ((s * 7) % 900_000)
      downTotal += 200_000 + ((s * 13) % 4_000_000)
      rows.push({
        id: randomUUID(),
        device_id: device.id,
        timestamp: new Date(at).toISOString(),
        // Deterministic, not Math.random: a perf dataset must be reproducible.
        upload_speed: Number((0.2 + ((s * 3) % 90) / 10).toFixed(2)),
        download_speed: Number((1.5 + ((s * 11) % 480) / 10).toFixed(2)),
        upload_total: String(upTotal),
        download_total: String(downTotal),
        created_at: new Date(at).toISOString(),
      })
    }

    for (let i = 0; i < rows.length; i += 200) {
      await db.insertInto('bandwidth_metrics').values(rows.slice(i, i + 200) as never).execute()
      bandwidthRows += Math.min(200, rows.length - i)
    }
  }

  // Two connection events per device per day.
  let connectionLogRows = 0
  for (const device of deviceRows) {
    const rows: Array<Record<string, unknown>> = []
    for (let d = options.historyDays - 1; d >= 0; d -= 1) {
      const at = now - d * 24 * HOUR
      rows.push({
        id: randomUUID(),
        device_id: device.id,
        event_type: 'connected',
        timestamp: new Date(at - 12 * HOUR).toISOString(),
        ip_address: device.ip_address,
        connection_duration: null,
        created_at: new Date(at - 12 * HOUR).toISOString(),
      })
      rows.push({
        id: randomUUID(),
        device_id: device.id,
        event_type: 'disconnected',
        timestamp: new Date(at - 4 * HOUR).toISOString(),
        ip_address: device.ip_address,
        connection_duration: 8 * 3600,
        created_at: new Date(at - 4 * HOUR).toISOString(),
      })
    }
    for (let i = 0; i < rows.length; i += 200) {
      await db.insertInto('connection_logs').values(rows.slice(i, i + 200) as never).execute()
      connectionLogRows += Math.min(200, rows.length - i)
    }
  }

  logger.info(
    { devices: deviceRows.length, bandwidthRows, connectionLogRows, databaseFile },
    'performance dataset built'
  )

  return {
    devices: deviceRows.length,
    bandwidthRows,
    connectionLogRows,
    databaseFile,
  }
}

// Entry point. `npm run perf:dataset` sets DB_FILE, so `run` is only reached
// when the module is executed directly rather than imported by the harness.
if (require.main === module) {
  buildPerfDataset()
    .then((summary) => {
      console.log(
        `  dataset ready: ${summary.devices} devices, ${summary.bandwidthRows.toLocaleString()} bandwidth rows -> ${summary.databaseFile}`
      )
    })
    .catch((err) => {
      logger.error({ err }, 'failed to build performance dataset')
      process.exitCode = 1
    })
    .finally(async () => {
      await db.destroy()
    })
}
