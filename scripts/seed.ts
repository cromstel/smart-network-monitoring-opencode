/**
 * Dev/seed data: 12 devices, 7 days of bandwidth, connection events,
 * one admin user and 3 alert rules. Safe to re-run: it refuses to seed
 * a database that already has devices.
 *
 * Byte counters are written as strings and stay below 2^63 so both
 * dialects store them exactly (AUDIT.md A-05).
 */
import { randomUUID } from 'node:crypto'
import { db } from '../lib/db/client'
import { createMigrator } from '../lib/db/migrator'
import { logger } from '../lib/utils/logger'
import type { DeviceType } from '../lib/types'

const DAY_MS = 24 * 60 * 60 * 1000

const CATEGORIES = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Personal', color: '#3b82f6' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Entertainment', color: '#8b5cf6' },
  { id: '10000000-0000-4000-8000-000000000003', name: 'Smart Home', color: '#10b981' },
]

interface SeedDevice {
  id: string
  mac: string
  ip: string
  hostname: string
  name: string
  type: DeviceType
  manufacturer: string
  signalStrength: number | null
  categoryId: string | null
}

const DEVICES: SeedDevice[] = [
  { id: randomUUID(), mac: 'A4:83:E7:2C:11:09', ip: '192.168.1.42', hostname: 'anas-iphone', name: "Ana's iPhone", type: 'phone', manufacturer: 'Apple, Inc.', signalStrength: -52, categoryId: CATEGORIES[0].id },
  { id: randomUUID(), mac: '3C:22:FB:44:90:12', ip: '192.168.1.43', hostname: 'anas-macbook', name: "Ana's MacBook", type: 'laptop', manufacturer: 'Apple, Inc.', signalStrength: -47, categoryId: CATEGORIES[0].id },
  { id: randomUUID(), mac: '58:8A:5A:71:CC:2F', ip: '192.168.1.44', hostname: 'living-tv', name: 'Living Room TV', type: 'tv', manufacturer: 'Samsung', signalStrength: null, categoryId: CATEGORIES[1].id },
  { id: randomUUID(), mac: 'D8:43:AE:12:AB:77', ip: '192.168.1.45', hostname: 'sonos-kitchen', name: 'Kitchen Speaker', type: 'speaker', manufacturer: 'Sonos', signalStrength: -61, categoryId: CATEGORIES[1].id },
  { id: randomUUID(), mac: 'B0:39:56:0D:39:11', ip: '192.168.1.46', hostname: 'hp-office', name: 'Office Printer', type: 'printer', manufacturer: 'HP', signalStrength: null, categoryId: null },
  { id: randomUUID(), mac: 'F8:E4:3B:5A:90:C8', ip: '192.168.1.47', hostname: 'ring-doorbell', name: 'Doorbell Cam', type: 'camera', manufacturer: 'Amazon', signalStrength: -70, categoryId: CATEGORIES[2].id },
  { id: randomUUID(), mac: '34:E6:D7:00:BE:3A', ip: '192.168.1.48', hostname: 'synology-nas', name: 'NAS Server', type: 'server', manufacturer: 'Synology', signalStrength: null, categoryId: null },
  { id: randomUUID(), mac: '04:9F:3E:22:11:5B', ip: '192.168.1.49', hostname: 'desk-laptop', name: 'Work Laptop', type: 'laptop', manufacturer: 'Lenovo', signalStrength: -55, categoryId: CATEGORIES[0].id },
  { id: randomUUID(), mac: '98:DA:32:7F:06:44', ip: '192.168.1.50', hostname: 'kindle', name: 'e-Reader', type: 'tablet', manufacturer: 'Amazon', signalStrength: -58, categoryId: null },
  { id: randomUUID(), mac: '48:CA:43:99:1B:E0', ip: '192.168.1.51', hostname: 'nest-thermostat', name: 'Thermostat', type: 'iot', manufacturer: 'Google', signalStrength: -64, categoryId: CATEGORIES[2].id },
  { id: randomUUID(), mac: '1C:B7:2C:44:FF:02', ip: '192.168.1.52', hostname: 'game-ps5', name: 'PlayStation 5', type: 'tv', manufacturer: 'Sony', signalStrength: -50, categoryId: CATEGORIES[1].id },
  { id: randomUUID(), mac: '6C:37:2B:EE:26:81', ip: '192.168.1.53', hostname: 'unifi-switch', name: 'Network Switch', type: 'switch', manufacturer: 'Ubiquiti', signalStrength: null, categoryId: null },
]

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

async function seedBandwidth(now: number): Promise<void> {
  // Two samples per hour per device over 7 days: 12 * 14 * 24 = 4 032 rows.
  const rows = []
  const SAMPLE_MS = 30 * 60 * 1000
  for (let day = 7 - 1; day >= 0; day -= 1) {
    for (let slot = 0; slot < 48; slot += 1) {
      const t = now - day * DAY_MS - Math.floor(slot / 2) * 60 * 60 * 1000 - (slot % 2) * SAMPLE_MS
      if (t > now) continue
      for (let i = 0; i < DEVICES.length; i += 1) {
        const base = (day * 48 + slot) * DEVICES.length + i
        const stepping = i * 4096 * 1024 + base * 65536
        rows.push({
          id: randomUUID(),
          device_id: DEVICES[i].id,
          timestamp: iso(t),
          upload_speed: Number((0.2 + ((i * 3 + slot) % 9) * 0.4).toFixed(2)),
          download_speed: Number((1.2 + ((i * 5 + day * 7) % 23) * 3.1).toFixed(2)),
          upload_total: String(stepping),
          download_total: String(stepping * 9),
          created_at: iso(t),
        })
      }
    }
  }
  for (let i = 0; i < rows.length; i += 250) {
    await db.insertInto('bandwidth_metrics').values(rows.slice(i, i + 250)).execute()
  }
}

async function run(): Promise<void> {
  const migrate = await createMigrator(db).migrateToLatest()
  if (migrate.error) throw migrate.error

  const existing = await db
    .selectFrom('devices')
    .select(db.fn.countAll<number>().as('count'))
    .executeTakeFirst()
  if (Number(existing?.count ?? 0) > 0) {
    logger.info('devices table already has rows — refusing to double-seed. Skipping.')
    return
  }

  const now = Date.now()
  const created = iso(now)

  await db
    .insertInto('device_categories')
    .values(CATEGORIES.map((c) => ({ ...c, created_at: created, updated_at: created })))
    .execute()

  for (let i = 0; i < DEVICES.length; i += 1) {
    const d = DEVICES[i]
    const firstSeen = iso(now - 45 * DAY_MS)
    await db
      .insertInto('devices')
      .values({
        id: d.id,
        mac_address: d.mac,
        ip_address: d.ip,
        hostname: d.hostname,
        device_name: d.name,
        device_type: d.type,
        manufacturer: d.manufacturer,
        signal_strength: d.signalStrength,
        status: i === 11 ? 'offline' : 'online',
        is_blocked: 0,
        is_ignored: 0,
        total_connection_time: (3 + (i % 5)) * 24 * 3600,
        category_id: d.categoryId,
        first_seen: firstSeen,
        last_seen: iso(now - (i === 11 ? 2 * DAY_MS : 40_000)),
        created_at: firstSeen,
        updated_at: iso(now - 40_000),
      })
      .execute()
  }

  await seedBandwidth(now)

  // Connection log: one connect + disconnect per day for the last 3 days.
  for (const d of DEVICES) {
    for (let day = 2; day >= 0; day -= 1) {
      const dayStart = now - day * DAY_MS
      await db
        .insertInto('connection_logs')
        .values([
          {
            id: randomUUID(),
            device_id: d.id,
            event_type: 'connected',
            timestamp: iso(dayStart - 12 * 3600 * 1000),
            ip_address: d.ip,
            connection_duration: null,
            created_at: iso(dayStart - 12 * 3600 * 1000),
          },
          {
            id: randomUUID(),
            device_id: d.id,
            event_type: 'disconnected',
            timestamp: iso(dayStart - 12 * 3600 * 1000 + 8 * 3600 * 1000),
            ip_address: d.ip,
            connection_duration: 8 * 3600,
            created_at: iso(dayStart - 12 * 3600 * 1000 + 8 * 3600 * 1000),
          },
        ])
        .execute()
    }
  }

  const adminId = randomUUID()
  await db
    .insertInto('users')
    .values({
      id: adminId,
      email: 'admin@example.com',
      // Placeholder — auth lands in Phase 3. Never used for a real login.
      password_hash: 'seed-only-no-login',
      name: 'Seed Admin',
      role: 'ADMIN',
      is_active: 1,
      created_at: created,
      updated_at: created,
    })
    .execute()

  await db
    .insertInto('user_settings')
    .values({
      id: randomUUID(),
      user_id: adminId,
      created_at: created,
      updated_at: created,
    })
    .execute()

  await db
    .insertInto('device_alerts')
    .values([
      { id: randomUUID(), user_id: adminId, device_id: null, alert_type: 'unknown_device', threshold: null, is_active: 1, created_at: created, updated_at: created },
      { id: randomUUID(), user_id: adminId, device_id: DEVICES[0].id, alert_type: 'bandwidth_exceeded', threshold: 50, is_active: 1, created_at: created, updated_at: created },
      { id: randomUUID(), user_id: adminId, device_id: DEVICES[11].id, alert_type: 'device_offline', threshold: null, is_active: 1, created_at: created, updated_at: created },
    ])
    .execute()

  logger.info('seed complete — 12 devices, ~4k bandwidth rows, connection logs, 3 alerts')
}

run()
  .catch((err) => {
    logger.error({ err }, 'seeding failed')
    process.exitCode = 1
  })
  .finally(async () => {
    await db.destroy()
  })