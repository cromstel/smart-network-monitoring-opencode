import type { Kysely } from 'kysely'
import type { ForeignKeyConstraintBuilder } from 'kysely'
import type { DB } from '../schema'

const onDeleteCascade = (cb: ForeignKeyConstraintBuilder) => cb.onDelete('cascade')

export async function up(db: Kysely<DB>): Promise<void> {
  await db.schema
    .createTable('bandwidth_metrics')
    .addColumn('id', 'varchar(36)', (c) => c.primaryKey())
    .addColumn('device_id', 'varchar(36)', (c) => c.notNull())
    .addColumn('timestamp', 'varchar(64)', (c) => c.notNull())
    .addColumn('upload_speed', 'real', (c) => c.notNull().defaultTo(0))
    .addColumn('download_speed', 'real', (c) => c.notNull().defaultTo(0))
    .addColumn('upload_total', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('download_total', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', 'varchar(64)', (c) => c.notNull())
    .addForeignKeyConstraint('fk_bm_device', ['device_id'], 'devices', ['id'], onDeleteCascade)
    .execute()

  await db.schema
    .createTable('bandwidth_hourly')
    .addColumn('id', 'varchar(36)', (c) => c.primaryKey())
    .addColumn('device_id', 'varchar(36)', (c) => c.notNull())
    .addColumn('hour_start', 'varchar(64)', (c) => c.notNull())
    .addColumn('avg_upload_speed', 'real', (c) => c.notNull().defaultTo(0))
    .addColumn('avg_download_speed', 'real', (c) => c.notNull().defaultTo(0))
    .addColumn('peak_upload_speed', 'real', (c) => c.notNull().defaultTo(0))
    .addColumn('peak_download_speed', 'real', (c) => c.notNull().defaultTo(0))
    .addColumn('bytes_uploaded', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('bytes_downloaded', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('sample_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', 'varchar(64)', (c) => c.notNull())
    .addUniqueConstraint('uq_bh_device_hour', ['device_id', 'hour_start'])
    .addForeignKeyConstraint('fk_bh_device', ['device_id'], 'devices', ['id'], onDeleteCascade)
    .execute()

  await db.schema
    .createIndex('idx_bm_timestamp')
    .on('bandwidth_metrics')
    .columns(['timestamp'])
    .execute()
  await db.schema
    .createIndex('idx_bm_device_time')
    .on('bandwidth_metrics')
    .columns(['device_id', 'timestamp'])
    .execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.dropIndex('idx_bm_device_time').execute()
  await db.schema.dropIndex('idx_bm_timestamp').execute()
  await db.schema.dropTable('bandwidth_hourly').execute()
  await db.schema.dropTable('bandwidth_metrics').execute()
}