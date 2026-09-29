import type { Kysely } from 'kysely'
import type { ForeignKeyConstraintBuilder } from 'kysely'
import type { DB } from '../schema'

const onDeleteSetNull = (cb: ForeignKeyConstraintBuilder) => cb.onDelete('set null')

export async function up(db: Kysely<DB>): Promise<void> {
  await db.schema
    .createTable('device_categories')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('name', 'varchar(100)', (c) => c.notNull())
    .addColumn('color', 'varchar(7)', (c) => c.notNull().defaultTo('#3b82f6'))
    .addColumn('icon', 'varchar(50)')
    .addColumn('description', 'text')
    .addColumn('created_at', 'varchar(64)', (c) => c.notNull())
    .addColumn('updated_at', 'varchar(64)', (c) => c.notNull())
    .addUniqueConstraint('uq_dc_name', ['name'])
    .execute()

  await db.schema
    .createTable('devices')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('mac_address', 'varchar(17)', (c) => c.notNull())
    .addColumn('ip_address', 'varchar(45)', (c) => c.notNull())
    .addColumn('hostname', 'varchar(255)')
    .addColumn('device_name', 'varchar(255)')
    .addColumn('device_type', 'varchar(50)', (c) => c.notNull().defaultTo('unknown'))
    .addColumn('manufacturer', 'varchar(255)')
    .addColumn('signal_strength', 'integer')
    .addColumn('status', 'varchar(20)', (c) => c.notNull().defaultTo('offline'))
    .addColumn('is_blocked', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('is_ignored', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('total_connection_time', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('category_id', 'uuid')
    .addColumn('first_seen', 'varchar(64)', (c) => c.notNull())
    .addColumn('last_seen', 'varchar(64)', (c) => c.notNull())
    .addColumn('created_at', 'varchar(64)', (c) => c.notNull())
    .addColumn('updated_at', 'varchar(64)', (c) => c.notNull())
    .addUniqueConstraint('uq_devices_mac', ['mac_address'])
    .addForeignKeyConstraint('fk_devices_category', ['category_id'], 'device_categories', ['id'], onDeleteSetNull)
    .execute()

  await db.schema.createIndex('idx_devices_status').on('devices').columns(['status']).execute()
  await db.schema.createIndex('idx_devices_last_seen').on('devices').columns(['last_seen']).execute()
  await db.schema.createIndex('idx_devices_category').on('devices').columns(['category_id']).execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.dropIndex('idx_devices_status').execute()
  await db.schema.dropIndex('idx_devices_last_seen').execute()
  await db.schema.dropIndex('idx_devices_category').execute()
  await db.schema.dropTable('devices').execute()
  await db.schema.dropTable('device_categories').execute()
}