import { Migrator } from 'kysely'
import type { Kysely } from 'kysely'
import type { DB } from './schema'
import { db } from './client'
import * as Migration001Devices from './migrations/001_devices'
import * as Migration002Bandwidth from './migrations/002_bandwidth'
import * as Migration003ConnectionLogs from './migrations/003_connection_logs'
import * as Migration004AlertsNotifications from './migrations/004_alerts_notifications'
import * as Migration005SettingsRouter from './migrations/005_settings_router'
import * as Migration006NetworkMetrics from './migrations/006_network_metrics'

export const migrations: Record<string, { up: (db: Kysely<DB>) => Promise<void>; down: (db: Kysely<DB>) => Promise<void> }> = {
  Migration001Devices,
  Migration002Bandwidth,
  Migration003ConnectionLogs,
  Migration004AlertsNotifications,
  Migration005SettingsRouter,
  Migration006NetworkMetrics,
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