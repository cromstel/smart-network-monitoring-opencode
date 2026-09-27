import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db/client'
import { createMigrator } from '@/lib/db/migrator'
import { pruneData } from '../pruneJob'
import { rollupHourly } from '../rollupJob'

jest.mock('@/lib/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

const RETENTION_DAYS = 30

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(() => ({
    DB_CLIENT: 'sqlite',
    DATA_RETENTION_DAYS: 30,
    NODE_ENV: 'test',
  })),
}))

const DAY = 24 * 60 * 60 * 1000

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString()
}

describe('scheduled jobs — retention and rollup', () => {
  let deviceId: string
  let userId: string

  beforeAll(async () => {
    const result = await createMigrator(db).migrateToLatest()
    if (result.error) throw result.error
  })

  beforeEach(async () => {
    for (const table of [
      'bandwidth_hourly',
      'bandwidth_metrics',
      'connection_logs',
      'notifications',
      'network_scan_history',
      'sessions',
      'device_alerts',
      'user_settings',
      'users',
      'devices',
    ] as const) {
      await db.deleteFrom(table).execute()
    }

    userId = randomUUID()
    const now = new Date().toISOString()
    await db
      .insertInto('users')
      .values({
        id: userId,
        email: `jobs-${userId}@example.com`,
        password_hash: 'x',
        name: 'Jobs',
        role: 'ADMIN',
        is_active: 1,
        created_at: now,
        updated_at: now,
      })
      .execute()

    deviceId = randomUUID()
    await db
      .insertInto('devices')
      .values({
        id: deviceId,
        mac_address: 'AA:BB:CC:00:11:22',
        ip_address: '192.168.1.5',
        device_type: 'laptop',
        status: 'online',
        total_connection_time: '0',
        first_seen: iso(200 * DAY),
        last_seen: iso(1 * DAY),
        created_at: iso(200 * DAY),
        updated_at: iso(1 * DAY),
      })
      .execute()
  })

  afterAll(async () => {
    await db.destroy()
    delete (globalThis as { __db?: unknown }).__db
  })

  describe('pruneData — F-51 retention is actually enforced', () => {
    it('deletes rows past the retention window and keeps recent ones', async () => {
      await db
        .insertInto('bandwidth_metrics')
        .values([
          {
            id: randomUUID(),
            device_id: deviceId,
            timestamp: iso(RETENTION_DAYS * DAY + 5 * DAY), // too old
            upload_speed: 1,
            download_speed: 1,
            upload_total: '10',
            download_total: '10',
            created_at: iso(RETENTION_DAYS * DAY + 5 * DAY),
          },
          {
            id: randomUUID(),
            device_id: deviceId,
            timestamp: iso(2 * DAY), // inside the window
            upload_speed: 1,
            download_speed: 1,
            upload_total: '20',
            download_total: '20',
            created_at: iso(2 * DAY),
          },
        ])
        .execute()

      await db
        .insertInto('connection_logs')
        .values([
          {
            id: randomUUID(),
            device_id: deviceId,
            event_type: 'connected',
            timestamp: iso(RETENTION_DAYS * DAY + 10 * DAY),
            created_at: iso(RETENTION_DAYS * DAY + 10 * DAY),
          },
          {
            id: randomUUID(),
            device_id: deviceId,
            event_type: 'disconnected',
            timestamp: iso(1 * DAY),
            created_at: iso(1 * DAY),
          },
        ])
        .execute()

      const result = await pruneData()

      expect(result.bandwidthMetrics).toBe(1)
      expect(result.connectionLogs).toBe(1)

      const metrics = await db.selectFrom('bandwidth_metrics').select('timestamp').execute()
      expect(metrics).toHaveLength(1)
      expect(new Date(metrics[0]!.timestamp).getTime()).toBeGreaterThan(
        Date.now() - RETENTION_DAYS * DAY
      )

      const logs = await db.selectFrom('connection_logs').select('timestamp').execute()
      expect(logs).toHaveLength(1)
    })

    it('is idempotent — a second run deletes nothing more', async () => {
      await db
        .insertInto('bandwidth_metrics')
        .values({
          id: randomUUID(),
          device_id: deviceId,
          timestamp: iso(RETENTION_DAYS * DAY + 1 * DAY),
          upload_speed: 1,
          download_speed: 1,
          upload_total: '1',
          download_total: '1',
          created_at: iso(RETENTION_DAYS * DAY + 1 * DAY),
        })
        .execute()

      const first = await pruneData()
      expect(first.bandwidthMetrics).toBe(1)

      const second = await pruneData()
      expect(second.bandwidthMetrics).toBe(0)
    })

    it('removes expired sessions regardless of retention', async () => {
      await db
        .insertInto('sessions')
        .values([
          {
            id: randomUUID(),
            user_id: userId,
            token_hash: 'expired-hash',
            expires_at: iso(2 * DAY),
            created_at: iso(3 * DAY),
          },
          {
            id: randomUUID(),
            user_id: userId,
            token_hash: 'live-hash',
            expires_at: new Date(Date.now() + 7 * DAY).toISOString(),
            created_at: new Date().toISOString(),
          },
        ])
        .execute()

      const result = await pruneData()
      expect(result.sessions).toBe(1)

      const remaining = await db.selectFrom('sessions').select('token_hash').execute()
      expect(remaining.map((s) => s.token_hash)).toEqual(['live-hash'])
    })

    it('keeps scan history for a week then drops it', async () => {
      await db
        .insertInto('network_scan_history')
        .values([
          {
            id: randomUUID(),
            scanner_name: 'simulated',
            scan_duration: 10,
            device_count: 1,
            success_count: 1,
            failure_count: 0,
            status: 'success',
            error_message: null,
            created_at: iso(10 * DAY),
          },
          {
            id: randomUUID(),
            scanner_name: 'simulated',
            scan_duration: 10,
            device_count: 1,
            success_count: 1,
            failure_count: 0,
            status: 'success',
            error_message: null,
            created_at: iso(1 * DAY),
          },
        ])
        .execute()

      const result = await pruneData()
      expect(result.scanHistory).toBe(1)
    })
  })

  describe('rollupHourly — hourly aggregates', () => {
    it('aggregates the previous hour into bandwidth_hourly', async () => {
      const now = new Date()
      const hourStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() - 1, 0, 0)
      )
      const inside = new Date(hourStart.getTime() + 10 * 60 * 1000).toISOString()
      const outside = new Date(hourStart.getTime() - 60 * 60 * 1000).toISOString()

      await db
        .insertInto('bandwidth_metrics')
        .values([
          {
            id: randomUUID(),
            device_id: deviceId,
            timestamp: inside,
            upload_speed: 2,
            download_speed: 10,
            upload_total: '100',
            download_total: '500',
            created_at: inside,
          },
          {
            id: randomUUID(),
            device_id: deviceId,
            timestamp: inside,
            upload_speed: 4,
            download_speed: 30,
            upload_total: '200',
            download_total: '700',
            created_at: inside,
          },
          {
            id: randomUUID(),
            device_id: deviceId,
            timestamp: outside, // previous hour, must be excluded
            upload_speed: 99,
            download_speed: 99,
            upload_total: '9999',
            download_total: '9999',
            created_at: outside,
          },
        ])
        .execute()

      await rollupHourly()

      const rows = await db.selectFrom('bandwidth_hourly').selectAll().execute()
      expect(rows).toHaveLength(1)

      const row = rows[0]!
      expect(row.device_id).toBe(deviceId)
      expect(Number(row.sample_count)).toBe(2)
      expect(Number(row.avg_download_speed)).toBeCloseTo(20, 5)
      expect(Number(row.peak_download_speed)).toBeCloseTo(30, 5)
      expect(Number(row.avg_upload_speed)).toBeCloseTo(3, 5)
    })

    it('does not double-count when run twice for the same hour', async () => {
      const now = new Date()
      const hourStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() - 1, 0, 0)
      )
      const inside = new Date(hourStart.getTime() + 5 * 60 * 1000).toISOString()

      await db
        .insertInto('bandwidth_metrics')
        .values({
          id: randomUUID(),
          device_id: deviceId,
          timestamp: inside,
          upload_speed: 3,
          download_speed: 6,
          upload_total: '111',
          download_total: '222',
          created_at: inside,
        })
        .execute()

      await rollupHourly()
      await rollupHourly()

      const rows = await db.selectFrom('bandwidth_hourly').selectAll().execute()
      expect(rows).toHaveLength(1)
      expect(Number(rows[0]!.sample_count)).toBe(1)
    })
  })
})
