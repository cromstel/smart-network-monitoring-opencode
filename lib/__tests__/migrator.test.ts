import { Kysely, SqliteDialect, NO_MIGRATIONS } from 'kysely'
import Database from 'better-sqlite3'
import { createMigrator } from '../db/migrator'
import type { DB } from '../db/schema'

const EXPECTED_TABLES = [
  'device_categories',
  'devices',
  'bandwidth_metrics',
  'bandwidth_hourly',
  'connection_logs',
  'users',
  'sessions',
  'device_alerts',
  'notifications',
  'user_settings',
  'router_config',
  'network_metrics',
  'network_scan_history',
]

function createTestDb(): Kysely<DB> {
  const instance = new Database(':memory:')
  instance.pragma('foreign_keys = ON')
  return new Kysely<DB>({ dialect: new SqliteDialect({ database: instance }) })
}

describe('migrations', () => {
  let db: Kysely<DB>

  beforeAll(() => {
    db = createTestDb()
  })

  afterAll(async () => {
    await db.destroy()
  })

  it('migrates to latest and creates every documented table', async () => {
    const migrator = createMigrator(db)
    const result = await migrator.migrateToLatest()
    expect(result.error).toBeUndefined()

    const tables = await db.introspection.getTables()
    const names = tables.map((t) => t.name)
    for (const expected of EXPECTED_TABLES) {
      expect(names).toContain(expected)
    }
  })

  it('rolls back to zero and re-migrates cleanly', async () => {
    const migrator = createMigrator(db)
    const down = await migrator.migrateTo(NO_MIGRATIONS)
    expect(down.error).toBeUndefined()

    const afterZero = await db.introspection.getTables()
    expect(afterZero.map((t) => t.name)).not.toContain('devices')

    const up = await migrator.migrateToLatest()
    expect(up.error).toBeUndefined()

    const tables = await db.introspection.getTables()
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(EXPECTED_TABLES)
    )
  })

  it('enforces the foreign key pragma on cascade deletes', async () => {
    const migrator = createMigrator(db)
    await migrator.migrateToLatest()

    const deviceId = '00000000-0000-4000-8000-000000000001'
    await db
      .insertInto('devices')
      .values({
        id: deviceId,
        mac_address: 'A4:83:E7:2C:11:09',
        ip_address: '192.168.1.42',
        device_type: 'unknown',
        status: 'offline',
        total_connection_time: 0,
        first_seen: '2026-01-01T00:00:00.000Z',
        last_seen: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      })
      .execute()

    await db
      .insertInto('bandwidth_metrics')
      .values({
        id: '00000000-0000-4000-8000-000000000002',
        device_id: deviceId,
        timestamp: '2026-01-01T00:00:01.000Z',
        upload_speed: 0,
        download_speed: 0,
        upload_total: 0,
        download_total: 0,
        created_at: '2026-01-01T00:00:00.000Z',
      })
      .execute()

    await db.deleteFrom('devices').where('id', '=', deviceId).execute()

    const remaining = await db
      .selectFrom('bandwidth_metrics')
      .selectAll()
      .execute()

    expect(remaining).toHaveLength(0)
  })
})