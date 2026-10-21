/**
 * Development seed: 12 devices, 7 days of bandwidth, connection events and
 * three alert rules. Safe to re-run — it refuses to seed a database that
 * already has devices.
 *
 * ## Accounts
 *
 * **This script creates no account unless you name one.** ER-41 removed the
 * hardcoded `admin@network-monitor.local` / known password that used to be
 * written here, because a seed script that runs unattended against whatever
 * `DB_FILE` happens to point at is exactly how a known credential ends up in a
 * database somebody then exposes.
 *
 * To create the first account, either:
 *
 *   1. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the environment and re-run
 *      this script, or
 *   2. Start the app and use `/auth/setup`, which is the supported first-run
 *      path (it creates the ADMIN and then refuses further calls).
 *
 * With neither set, this seeds devices and demo activity and reports that no
 * account was created, which is the correct outcome for a machine nobody will
 * sign in to.
 *
 * ## Byte counters
 *
 * Written as strings and kept below 2^63 so both dialects store them exactly
 * (`AUDIT.md` A-05).
 *
 * ## Usage
 *
 *   npm run db:seed
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npm run db:seed
 */

import { randomUUID } from 'node:crypto'
import { db } from '../lib/db/client'
import { runMigrations } from '../lib/db/migrator'
import { hashPassword } from '../lib/utils/crypto'
import { logger } from '../lib/utils/logger'
import type { DeviceType } from '../lib/types'

const HOUR = 3_600_000
const DAY = 24 * HOUR

const DEVICES: Array<{ mac: string; ip: string; name: string; type: DeviceType; vendor: string }> = [
  { mac: 'A4:83:E7:2C:11:09', ip: '192.168.1.42', name: "Ana's iPhone", type: 'phone', vendor: 'Apple, Inc.' },
  { mac: '3C:22:FB:44:90:12', ip: '192.168.1.43', name: "Ana's MacBook", type: 'laptop', vendor: 'Apple, Inc.' },
  { mac: '34:E6:D7:00:BE:3A', ip: '192.168.1.48', name: 'NAS Server', type: 'server', vendor: 'Synology' },
  { mac: 'B0:39:56:0D:39:11', ip: '192.168.1.46', name: 'Office Printer', type: 'printer', vendor: 'HP' },
  { mac: '58:8A:5A:71:CC:2F', ip: '192.168.1.44', name: 'Living Room TV', type: 'tv', vendor: 'Samsung' },
  { mac: 'D8:3A:DD:1F:22:7B', ip: '192.168.1.50', name: 'Kitchen Speaker', type: 'speaker', vendor: 'Sonos' },
  { mac: '9C:5C:8E:41:0A:63', ip: '192.168.1.51', name: 'Front Door Camera', type: 'camera', vendor: 'Ubiquiti' },
  { mac: 'E4:5F:01:7B:9C:20', ip: '192.168.1.52', name: 'Raspberry Pi', type: 'iot', vendor: 'Raspberry Pi' },
  { mac: '00:1A:2B:3C:4D:5E', ip: '192.168.1.53', name: 'Home Office Desktop', type: 'desktop', vendor: 'Intel Corporate' },
  { mac: 'AC:84:C6:9E:11:34', ip: '192.168.1.54', name: 'Bedroom Tablet', type: 'tablet', vendor: 'Samsung' },
  { mac: '1C:BF:CE:22:88:41', ip: '192.168.1.55', name: 'Thermostat', type: 'iot', vendor: 'TP-Link' },
  { mac: '78:45:58:AA:12:9F', ip: '192.168.1.56', name: 'Game Console', type: 'iot', vendor: 'Sony' },
]

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString()
}

/**
 * Resolves the optional first account.
 *
 * Both variables are required together: an email with no password would create
 * an account nobody can sign in to, and a password with no email has no
 * subject. A half-set pair is a mistake worth reporting, not a value to guess.
 */
function resolveSeedAccount():
  | { email: string; password: string; name: string }
  | null {
  const email = process.env.ADMIN_EMAIL?.trim()
  const password = process.env.ADMIN_PASSWORD
  const name = process.env.ADMIN_NAME?.trim() || 'Platform Admin'

  if (!email && !password) return null

  if (!email || !password) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD must be set together (or neither). ' +
        'Refusing to create an account from a half-configured pair.'
    )
  }

  // The application enforces a 12-character policy at /api/setup; the seed
  // writes to the same table, so it applies the same floor rather than
  // creating an account the login form would have refused.
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters, matching the setup policy.')
  }

  return { email, password, name }
}

async function run(): Promise<void> {
  await runMigrations()

  const existing = await db.selectFrom('devices').select('id').limit(1).executeTakeFirst()
  if (existing) {
    logger.info('Database already seeded — refusing to run again.')
    return
  }

  const now = new Date().toISOString()
  const deviceIds: string[] = []

  for (const d of DEVICES) {
    const id = randomUUID()
    deviceIds.push(id)

    await db
      .insertInto('devices')
      .values({
        id,
        mac_address: d.mac,
        ip_address: d.ip,
        hostname: d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        device_name: d.name,
        device_type: d.type,
        manufacturer: d.vendor,
        signal_strength: -40 - (deviceIds.length % 30),
        status: 'online',
        is_blocked: 0,
        is_ignored: 0,
        total_connection_time: 3600 * (1 + (deviceIds.length % 8)),
        first_seen: iso(7 * DAY),
        last_seen: iso(30_000),
        created_at: iso(7 * DAY),
        updated_at: now,
      })
      .execute()
  }

  logger.info(`Seeded ${DEVICES.length} devices.`)

  // Seven days of bandwidth, two samples an hour. Inserts are batched because
  // a per-row round trip over ~2,000 rows is slow on MySQL and pointless on
  // SQLite.
  const samples: Array<Record<string, unknown>> = []
  for (const deviceId of deviceIds) {
    let uploadTotal = 0
    let downloadTotal = 0

    for (let h = 7 * 24; h >= 0; h -= 1) {
      const uploadBytes = 250_000 + Math.floor(Math.random() * 900_000)
      const downloadBytes = 6_000_000 + Math.floor(Math.random() * 20_000_000)
      uploadTotal += uploadBytes
      downloadTotal += downloadBytes

      samples.push({
        id: randomUUID(),
        device_id: deviceId,
        timestamp: iso(h * HOUR),
        upload_speed: Number((uploadBytes * 8 / 3_600_000).toFixed(3)),
        download_speed: Number((downloadBytes * 8 / 3_600_000).toFixed(3)),
        upload_total: String(uploadTotal),
        download_total: String(downloadTotal),
        created_at: iso(h * HOUR),
      })
    }
  }

  for (let i = 0; i < samples.length; i += 200) {
    await db
      .insertInto('bandwidth_metrics')
      .values(samples.slice(i, i + 200) as never)
      .execute()
  }

  logger.info(`Seeded ${samples.length} bandwidth samples.`)

  // Three days of connect/disconnect pairs, so the connection history has
  // something to draw and the offline detection has prior state to diff.
  const logs: Array<Record<string, unknown>> = []
  for (const deviceId of deviceIds) {
    for (let d = 3; d >= 1; d -= 1) {
      const connectedAt = iso(d * DAY)
      logs.push({
        id: randomUUID(),
        device_id: deviceId,
        event_type: 'connected',
        timestamp: connectedAt,
        ip_address: null,
        connection_duration: null,
        created_at: connectedAt,
      })
      logs.push({
        id: randomUUID(),
        device_id: deviceId,
        event_type: 'disconnected',
        timestamp: iso(d * DAY - 4 * HOUR),
        ip_address: null,
        connection_duration: 4 * 3600,
        created_at: iso(d * DAY - 4 * HOUR),
      })
    }
  }

  for (let i = 0; i < logs.length; i += 200) {
    await db
      .insertInto('connection_logs')
      .values(logs.slice(i, i + 200) as never)
      .execute()
  }

  logger.info(`Seeded ${logs.length} connection events.`)

  // --- Account (optional) --------------------------------------------------
  const account = resolveSeedAccount()

  if (!account) {
    logger.info(
      'No ADMIN_EMAIL/ADMIN_PASSWORD set — no account created. ' +
        'Set both to seed one, or use /auth/setup to create the first account.'
    )
    return
  }

  const userId = randomUUID()
  await db
    .insertInto('users')
    .values({
      id: userId,
      email: account.email,
      password_hash: await hashPassword(account.password),
      name: account.name,
      role: 'ADMIN',
      is_active: 1,
      created_at: now,
      updated_at: now,
    })
    .execute()

  await db
    .insertInto('user_settings')
    .values({
      id: randomUUID(),
      user_id: userId,
      network_subnet: process.env.NETWORK_SUBNET?.trim() || '192.168.1.0/24',
      created_at: now,
      updated_at: now,
    })
    .execute()

  await db
    .insertInto('device_alerts')
    .values([
      {
        id: randomUUID(),
        user_id: userId,
        device_id: null,
        alert_type: 'bandwidth_exceeded',
        threshold: 100,
        is_active: 1,
        created_at: now,
        updated_at: now,
      },
      {
        id: randomUUID(),
        user_id: userId,
        device_id: null,
        alert_type: 'device_offline',
        threshold: null,
        is_active: 1,
        created_at: now,
        updated_at: now,
      },
      {
        id: randomUUID(),
        user_id: userId,
        device_id: deviceIds[0] ?? null,
        alert_type: 'unknown_device',
        threshold: null,
        is_active: 1,
        created_at: now,
        updated_at: now,
      },
    ])
    .execute()

  logger.info(`Seeded account ${account.email} with 3 alert rules.`)
}

run()
  .then(() => {
    logger.info('Seed complete.')
    process.exit(0)
  })
  .catch((error: unknown) => {
    logger.error({ err: error }, 'Seed failed')
    process.exit(1)
  })
