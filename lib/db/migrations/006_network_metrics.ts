import type { Kysely } from 'kysely'
import type { DB } from '../schema'

export async function up(db: Kysely<DB>): Promise<void> {
  await db.schema
    .createTable('network_metrics')
    .addColumn('id', 'varchar(36)', (c) => c.primaryKey())
    .addColumn('timestamp', 'varchar(64)', (c) => c.notNull())
    .addColumn('total_bandwidth_up', 'real', (c) => c.notNull().defaultTo(0))
    .addColumn('total_bandwidth_down', 'real', (c) => c.notNull().defaultTo(0))
    .addColumn('active_devices', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('online_devices', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('peak_bandwidth_up', 'real', (c) => c.notNull().defaultTo(0))
    .addColumn('peak_bandwidth_down', 'real', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', 'varchar(64)', (c) => c.notNull())
    .execute()

  await db.schema
    .createTable('network_scan_history')
    .addColumn('id', 'varchar(36)', (c) => c.primaryKey())
    .addColumn('scanner_name', 'varchar(20)', (c) => c.notNull())
    .addColumn('scan_duration', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('device_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('success_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('failure_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('status', 'varchar(20)', (c) => c.notNull())
    .addColumn('error_message', 'text')
    .addColumn('created_at', 'varchar(64)', (c) => c.notNull())
    .execute()

  await db.schema.createIndex('idx_nm_timestamp').on('network_metrics').columns(['timestamp']).execute()
  await db.schema.createIndex('idx_nsh_created').on('network_scan_history').columns(['created_at']).execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.dropIndex('idx_nsh_created').execute()
  await db.schema.dropIndex('idx_nm_timestamp').execute()
  await db.schema.dropTable('network_scan_history').execute()
  await db.schema.dropTable('network_metrics').execute()
}