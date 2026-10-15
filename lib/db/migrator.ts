import { Migrator } from 'kysely'
import type { Kysely } from 'kysely'
import type { DB } from './schema'
import { db } from './client'

/**
 * WHY TIMESTAMP COLUMNS ARE varchar(64) AND NOT datetime
 * =====================================================
 * Every timestamp in this application is an ISO-8601 UTC string produced by
 * Date.prototype.toISOString(), e.g. "2026-09-29T16:24:05.817Z". That is what
 * `schema.ts` declares (`created_at: string`, `timestamp: string`), and every
 * repository, mapper and serialiser treats them as strings.
 *
 * The migrations used to declare these columns `datetime`. SQLite stores such a
 * string in a DATETIME-affinity column without complaint, so the SQLite leg was
 * green. MariaDB does not — it rejects the format outright:
 *
 *   Incorrect datetime value: '2026-09-29T16:24:05.817Z'
 *   for column `devices`.`first_seen` at row 1
 *
 * so *every* write failed. Not a slow path or an edge case: the first
 * insert aborted the request. The database leg of CI (TODO.md B-14) was recorded
 * as "both green" and was not; deviceRepository.test.ts fails 6/6 on MariaDB for
 * this reason alone. Verified against MariaDB 12.3, which is what is deployed.
 *
 * Declaring the columns as text makes both dialects agree and matches the types
 * the code already uses. ISO-8601 UTC sorts correctly as a string, so range
 * queries (`timestamp >= ?`) and ORDER BY timestamp keep working unchanged.
 *
 * The alternative — a real DATETIME plus a dialect-aware conversion on every
 * write — was rejected deliberately: mysql2 would then hand back Date objects
 * where SQLite returns strings, contradicting every `string` in schema.ts and
 * pushing a conversion into every read path. If you are tempted to change these
 * back to datetime, run the MariaDB leg first:
 *
 *   DB_CLIENT=mysql DB_NAME=home_monitor_test npx jest lib/db

/**
 * WHY ID COLUMNS ARE varchar(36) AND NOT uuid
 * ==========================================
 * `uuid` is a MariaDB-specific data type, added in MariaDB 10.7. MySQL has no
 * equivalent: MySQL 8.4 reports zero UUID-capable types in
 * information_schema and rejects the column outright.
 *
 *   ERROR 1064 (42000): You have an error in your SQL syntax; check the manual
 *   that corresponds to your MySQL server version for the right syntax to use
 *   near 'uuid primary key)'
 *
 * So the schema could not be created on MySQL at all -- every migration failed
 * at the first CREATE TABLE and 72 of 198 tests failed before reaching any
 * application logic. It was invisible because only MariaDB was ever exercised:
 * the CI leg that would have caught it ran a different engine than the one in
 * the deployed container stack.
 *
 * `varchar(36)` is also what the code already assumes. Every id in
 * `schema.ts` is typed `string`, every id is produced by `randomUUID()` and
 * passed to the driver as a string. MariaDB's native uuid type stores exactly
 * that: 36 bytes of text, read back unchanged. Declaring it as varchar keeps
 * both engines byte-for-byte equivalent and matches the declared types.
 *
 * Same reasoning as the timestamp columns above, and for the same reason. */
import * as Migration001Devices from './migrations/001_devices'
import * as Migration002Bandwidth from './migrations/002_bandwidth'
import * as Migration003ConnectionLogs from './migrations/003_connection_logs'
import * as Migration004AlertsNotifications from './migrations/004_alerts_notifications'
import * as Migration005SettingsRouter from './migrations/005_settings_router'
import * as Migration006NetworkMetrics from './migrations/006_network_metrics'
import * as Migration007PaystackBilling from './migrations/007_paystack_billing'

export const migrations: Record<string, { up: (db: Kysely<DB>) => Promise<void>; down: (db: Kysely<DB>) => Promise<void> }> = {
  Migration001Devices,
  Migration002Bandwidth,
  Migration003ConnectionLogs,
  Migration004AlertsNotifications,
  Migration005SettingsRouter,
  Migration006NetworkMetrics,
  Migration007PaystackBilling,
}

export function createMigrator(db: Kysely<DB>): Migrator {
  return new Migrator({
    db,
    provider: {
      getMigrations: async () => migrations,
    },
  })
}

/**
 * Applies every pending migration against the shared client.
 * Idempotent — Kysely records what has run, so calling it on every boot is safe.
 * Returns the names that were applied by this call.
 */
export async function runMigrations(): Promise<string[]> {
  const { error, results } = await createMigrator(db).migrateToLatest()

  if (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }

  return (results ?? [])
    .filter((r) => r.status === 'Success')
    .map((r) => r.migrationName)
}