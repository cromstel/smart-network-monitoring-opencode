/**
 * E2E seed: a small, deterministic dataset with a *known* admin password so
 * the browser suite can sign in. Never use this script outside the E2E run —
 * `scripts/seed.ts` is the development one and deliberately has no usable
 * password.
 */
import { randomUUID } from 'node:crypto'
import { db } from '../lib/db/client'
import { runMigrations } from '../lib/db/migrator'
import { hashPassword } from '../lib/utils/crypto'
import { logger } from '../lib/utils/logger'
import type { DeviceType } from '../lib/types'

const ADMIN_EMAIL = 'e2e-admin@example.com'
const ADMIN_PASSWORD = 'E2e-Admin-Pass-2026'

const DEVICES: Array<{ mac: string; ip: string; name: string; type: DeviceType }> = [
  { mac: 'A4:83:E7:2C:11:09', ip: '192.168.1.42', name: "Ana's iPhone", type: 'phone' },
  { mac: '3C:22:FB:44:90:12', ip: '192.168.1.43', name: "Ana's MacBook", type: 'laptop' },
  { mac: '34:E6:D7:00:BE:3A', ip: '192.168.1.48', name: 'NAS Server', type: 'server' },
  { mac: 'B0:39:56:0D:39:11', ip: '192.168.1.46', name: 'Office Printer', type: 'printer' },
  { mac: '58:8A:5A:71:CC:2F', ip: '192.168.1.44', name: 'Living Room TV', type: 'tv' },
]

const HOUR = 3_600_000

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString()
}

async function run(): Promise<void> {
  // Refuse to run against anything but a throwaway database. Without this
  // guard the script silently writes to ./data/dev.db whenever DB_FILE is
  // unset, and the known-password admin lands in the developer's real data.
  const dbFile = process.env.DB_FILE ?? ''
  if (!dbFile || dbFile === './data/dev.db' || dbFile === 'data/dev.db') {
    throw new Error(
      `Refusing to seed: set DB_FILE to a dedicated test database, e.g. DB_FILE=./data/e2e.db. Got ${JSON.stringify(dbFile || '(unset)')}.`
    )
  }

  await runMigrations()

  const existing = await db.selectFrom('users').select('id').executeTakeFirst()
  if (existing) {
    logger.info('e2e database already seeded')
    return
  }

  const now = new Date().toISOString()
  const adminId = randomUUID()

  await db
    .insertInto('users')
    .values({
      id: adminId,
      email: ADMIN_EMAIL,
      password_hash: await hashPassword(ADMIN_PASSWORD),
      name: 'E2E Admin',
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
      user_id: adminId,
      network_subnet: '192.168.1.0/24',
      created_at: now,
      updated_at: now,
    })
    .execute()

  const deviceIds: string[] = []

  for (let i = 0; i < DEVICES.length; i += 1) {
    const d = DEVICES[i]!
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
        manufacturer: 'Test Vendor',
        signal_strength: -50,
        status: 'online',
        is_blocked: 0,
        is_ignored: 0,
        total_connection_time: 3600,
        first_seen: iso(7 * 24 * HOUR),
        last_seen: iso(30_000),
        created_at: iso(7 * 24 * HOUR),
        updated_at: now,
      })
      .execute()

    // Six hours of history so the detail chart has something to draw.
    const samples: Array<Record<string, unknown>> = []
    for (let h = 6; h >= 0; h -= 1) {
      samples.push({
        id: randomUUID(),
        device_id: id,
        timestamp: iso(h * HOUR),
        upload_speed: 0.5 + (h % 3) * 0.25,
        download_speed: 8 + (h % 5) * 2.5,
        upload_total: String(1_000_000 * (7 - h)),
        download_total: String(12_000_000 * (7 - h)),
        created_at: iso(h * HOUR),
      })
    }
    for (let s = 0; s < samples.length; s += 25) {
      await db
        .insertInto('bandwidth_metrics')
        .values(samples.slice(s, s + 25) as never)
        .execute()
    }
  }

  await db
    .insertInto('network_scan_history')
    .values({
      id: randomUUID(),
      scanner_name: 'simulated',
      scan_duration: 120,
      device_count: DEVICES.length,
      success_count: DEVICES.length,
      failure_count: 0,
      status: 'success',
      error_message: null,
      created_at: now,
    })
    .execute()

  logger.info({ devices: deviceIds.length, email: ADMIN_EMAIL }, 'e2e seed complete')
}

run()
  .catch((err) => {
    logger.error({ err }, 'e2e seeding failed')
    process.exitCode = 1
  })
  .finally(async () => {
    await db.destroy()
  })
