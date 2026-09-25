import type { Kysely } from 'kysely'
import type { ForeignKeyConstraintBuilder } from 'kysely'
import type { DB } from '../schema'

const onDeleteCascade = (cb: ForeignKeyConstraintBuilder) => cb.onDelete('cascade')

export async function up(db: Kysely<DB>): Promise<void> {
  await db.schema
    .createTable('connection_logs')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('device_id', 'uuid', (c) => c.notNull())
    .addColumn('event_type', 'varchar(20)', (c) => c.notNull())
    .addColumn('timestamp', 'datetime', (c) => c.notNull())
    .addColumn('ip_address', 'varchar(45)')
    .addColumn('connection_duration', 'integer')
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addForeignKeyConstraint('fk_cl_device', ['device_id'], 'devices', ['id'], onDeleteCascade)
    .execute()

  await db.schema.createIndex('idx_cl_event').on('connection_logs').columns(['event_type']).execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.dropIndex('idx_cl_event').execute()
  await db.schema.dropTable('connection_logs').execute()
}