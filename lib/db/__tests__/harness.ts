import { db } from '../client'
import { createMigrator } from '../migrator'

export type TestDbClient = 'sqlite' | 'mysql'

export interface TestDb {
  client: TestDbClient
  db: typeof db
  /** Empty the tables the repository tests touch, keeping FKs satisfied. */
  reset(): Promise<void>
  destroy(): Promise<void>
}

/**
 * Repository functions talk to the SHARED client (single pool — ARCHITECTURE
 * §4), so this harness drives that same instance. jest.setup.js points it at
 * `:memory:` (sqlite) by default; CI sets DB_CLIENT=mysql (docker-compose.yml)
 * so the identical spec runs against both dialects (TODO.md B-14).
 */
export async function createTestDb(): Promise<TestDb> {
  const client: TestDbClient = process.env.DB_CLIENT === 'mysql' ? 'mysql' : 'sqlite'

  const migrator = createMigrator(db)
  const result = await migrator.migrateToLatest()
  if (result.error) throw result.error

  const reset = async (): Promise<void> => {
    await db.deleteFrom('connection_logs').execute()
    await db.deleteFrom('bandwidth_metrics').execute()
    await db.deleteFrom('devices').execute()
    await db.deleteFrom('device_categories').execute()
  }

  const destroy = async (): Promise<void> => {
    await db.destroy()
    delete (globalThis as { __db?: unknown }).__db
  }

  return { client, db, reset, destroy }
}