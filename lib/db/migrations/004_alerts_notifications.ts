import type { Kysely } from 'kysely'
import type { ForeignKeyConstraintBuilder } from 'kysely'
import type { DB } from '../schema'

const onDeleteCascade = (cb: ForeignKeyConstraintBuilder) => cb.onDelete('cascade')
const onDeleteSetNull = (cb: ForeignKeyConstraintBuilder) => cb.onDelete('set null')

export async function up(db: Kysely<DB>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'varchar(36)', (c) => c.primaryKey())
    .addColumn('email', 'varchar(255)', (c) => c.notNull())
    .addColumn('password_hash', 'varchar(255)', (c) => c.notNull())
    .addColumn('name', 'varchar(255)')
    .addColumn('role', 'varchar(20)', (c) => c.notNull().defaultTo('VIEWER'))
    .addColumn('is_active', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('last_login_at', 'varchar(64)')
    .addColumn('created_at', 'varchar(64)', (c) => c.notNull())
    .addColumn('updated_at', 'varchar(64)', (c) => c.notNull())
    .addUniqueConstraint('uq_users_email', ['email'])
    .execute()

  await db.schema
    .createTable('sessions')
    .addColumn('id', 'varchar(36)', (c) => c.primaryKey())
    .addColumn('user_id', 'varchar(36)', (c) => c.notNull())
    .addColumn('token_hash', 'varchar(255)', (c) => c.notNull())
    .addColumn('expires_at', 'varchar(64)', (c) => c.notNull())
    .addColumn('ip_address', 'varchar(45)')
    .addColumn('user_agent', 'varchar(512)')
    .addColumn('created_at', 'varchar(64)', (c) => c.notNull())
    .addUniqueConstraint('uq_sessions_token', ['token_hash'])
    .addForeignKeyConstraint('fk_sessions_user', ['user_id'], 'users', ['id'], onDeleteCascade)
    .execute()

  await db.schema
    .createTable('device_alerts')
    .addColumn('id', 'varchar(36)', (c) => c.primaryKey())
    .addColumn('user_id', 'varchar(36)', (c) => c.notNull())
    .addColumn('device_id', 'varchar(36)')
    .addColumn('alert_type', 'varchar(50)', (c) => c.notNull())
    .addColumn('threshold', 'real')
    .addColumn('is_active', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('last_triggered', 'varchar(64)')
    .addColumn('trigger_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', 'varchar(64)', (c) => c.notNull())
    .addColumn('updated_at', 'varchar(64)', (c) => c.notNull())
    .addForeignKeyConstraint('fk_da_user', ['user_id'], 'users', ['id'], onDeleteCascade)
    .addForeignKeyConstraint('fk_da_device', ['device_id'], 'devices', ['id'], onDeleteCascade)
    .execute()

  await db.schema
    .createTable('notifications')
    .addColumn('id', 'varchar(36)', (c) => c.primaryKey())
    .addColumn('user_id', 'varchar(36)', (c) => c.notNull())
    .addColumn('device_id', 'varchar(36)')
    .addColumn('alert_id', 'varchar(36)')
    .addColumn('title', 'varchar(255)', (c) => c.notNull())
    .addColumn('message', 'text', (c) => c.notNull())
    .addColumn('type', 'varchar(20)', (c) => c.notNull().defaultTo('info'))
    .addColumn('priority', 'varchar(10)', (c) => c.notNull().defaultTo('medium'))
    .addColumn('is_read', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('read_at', 'varchar(64)')
    .addColumn('data', 'text')
    .addColumn('created_at', 'varchar(64)', (c) => c.notNull())
    .addForeignKeyConstraint('fk_n_user', ['user_id'], 'users', ['id'], onDeleteCascade)
    .addForeignKeyConstraint('fk_n_device', ['device_id'], 'devices', ['id'], onDeleteSetNull)
    .addForeignKeyConstraint('fk_n_alert', ['alert_id'], 'device_alerts', ['id'], onDeleteSetNull)
    .execute()

  await db.schema.createIndex('idx_da_user').on('device_alerts').columns(['user_id']).execute()
  await db.schema.createIndex('idx_da_device').on('device_alerts').columns(['device_id']).execute()
  await db.schema.createIndex('idx_sessions_user').on('sessions').columns(['user_id']).execute()
  await db.schema.createIndex('idx_sessions_expires').on('sessions').columns(['expires_at']).execute()
  await db.schema.createIndex('idx_n_user_read').on('notifications').columns(['user_id', 'is_read']).execute()
  await db.schema.createIndex('idx_n_created').on('notifications').columns(['created_at']).execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.dropIndex('idx_n_created').execute()
  await db.schema.dropIndex('idx_n_user_read').execute()
  await db.schema.dropIndex('idx_sessions_expires').execute()
  await db.schema.dropIndex('idx_sessions_user').execute()
  await db.schema.dropIndex('idx_da_device').execute()
  await db.schema.dropIndex('idx_da_user').execute()
  await db.schema.dropTable('notifications').execute()
  await db.schema.dropTable('device_alerts').execute()
  await db.schema.dropTable('sessions').execute()
  await db.schema.dropTable('users').execute()
}