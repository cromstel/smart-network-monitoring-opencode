import type { Kysely } from 'kysely'
import type { ForeignKeyConstraintBuilder } from 'kysely'
import type { DB } from '../schema'

const onDeleteCascade = (cb: ForeignKeyConstraintBuilder) => cb.onDelete('cascade')

export async function up(db: Kysely<DB>): Promise<void> {
  await db.schema
    .createTable('user_settings')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('user_id', 'uuid', (c) => c.notNull())
    .addColumn('scan_interval_seconds', 'integer', (c) => c.notNull().defaultTo(30))
    .addColumn('data_retention_days', 'integer', (c) => c.notNull().defaultTo(30))
    .addColumn('network_subnet', 'varchar(64)', (c) => c.notNull().defaultTo('192.168.1.0/24'))
    .addColumn('ignore_subnets', 'text')
    .addColumn('notify_new_devices', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('notify_device_offline', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('notify_high_bandwidth', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('bandwidth_threshold', 'real', (c) => c.notNull().defaultTo(100))
    .addColumn('theme', 'varchar(10)', (c) => c.notNull().defaultTo('dark'))
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .addUniqueConstraint('uq_us_user', ['user_id'])
    .addForeignKeyConstraint('fk_us_user', ['user_id'], 'users', ['id'], onDeleteCascade)
    .execute()

  await db.schema
    .createTable('router_config')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('router_type', 'varchar(50)', (c) => c.notNull())
    .addColumn('router_name', 'varchar(255)')
    .addColumn('router_ip', 'varchar(45)', (c) => c.notNull())
    .addColumn('port', 'integer', (c) => c.notNull().defaultTo(80))
    .addColumn('username', 'varchar(255)', (c) => c.notNull())
    .addColumn('password_encrypted', 'text', (c) => c.notNull())
    .addColumn('mac_address', 'varchar(17)')
    .addColumn('model_number', 'varchar(100)')
    .addColumn('firmware_version', 'varchar(100)')
    .addColumn('is_connected', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_check_at', 'datetime')
    .addColumn('last_success_at', 'datetime')
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .addUniqueConstraint('uq_rc_ip', ['router_ip'])
    .execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.dropTable('router_config').execute()
  await db.schema.dropTable('user_settings').execute()
}