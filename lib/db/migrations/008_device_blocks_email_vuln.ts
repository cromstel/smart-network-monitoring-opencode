import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // Add static_ip to devices
  await db.schema
    .alterTable('devices')
    .addColumn('static_ip', 'varchar(45)', (col) => col.defaultTo(null))
    .execute()

  // Device block rules (admin-controlled site/app blocking)
  await db.schema
    .createTable('device_blocks')
    .addColumn('id', 'varchar(36)', (col) => col.primaryKey().notNull())
    .addColumn('device_id', 'varchar(36)', (col) => col.notNull().references('devices.id').onDelete('cascade'))
    .addColumn('website_app', 'varchar(255)', (col) => col.notNull())
    .addColumn('is_active', 'integer', (col) => col.defaultTo(1).notNull())
    .addColumn('created_by', 'varchar(36)', (col) => col.notNull().references('users.id'))
    .addColumn('created_at', 'varchar', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute()

  await db.schema.createIndex('idx_device_blocks_device').on('device_blocks').columns(['device_id']).execute()
  await db.schema.createIndex('idx_device_blocks_website').on('device_blocks').columns(['website_app', 'is_active']).execute()

  // Email providers config
  await db.schema
    .createTable('email_providers')
    .addColumn('id', 'varchar(36)', (col) => col.primaryKey().notNull())
    .addColumn('provider_name', 'varchar(100)', (col) => col.notNull())
    .addColumn('smtp_host', 'varchar(255)', (col) => col.notNull())
    .addColumn('smtp_port', 'integer', (col) => col.notNull())
    .addColumn('smtp_user', 'varchar(255)', (col) => col.notNull())
    .addColumn('smtp_pass', 'varchar(255)', (col) => col.notNull())
    .addColumn('is_default', 'integer', (col) => col.defaultTo(0).notNull())
    .addColumn('created_at', 'varchar', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute()

  await db.schema.createIndex('idx_email_default').on('email_providers').columns(['is_default']).execute()

  // Vulnerability alerts
  await db.schema
    .createTable('vulnerability_alerts')
    .addColumn('id', 'varchar(36)', (col) => col.primaryKey().notNull())
    .addColumn('user_id', 'varchar(36)', (col) => col.notNull().references('users.id'))
    .addColumn('device_id', 'varchar(36)', (col) => col.references('devices.id').onDelete('cascade'))
    .addColumn('vulnerability_type', 'varchar(100)', (col) => col.notNull())
    .addColumn('severity', 'varchar(20)', (col) => col.notNull())
    .addColumn('message', 'text', (col) => col.notNull())
    .addColumn('is_read', 'integer', (col) => col.defaultTo(0).notNull())
    .addColumn('read_at', 'varchar', (col) => col.defaultTo(null))
    .addColumn('created_at', 'varchar', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute()

  await db.schema.createIndex('idx_vuln_user').on('vulnerability_alerts').columns(['user_id']).execute()
  await db.schema.createIndex('idx_vuln_read').on('vulnerability_alerts').columns(['is_read']).execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('vulnerability_alerts').execute()
  await db.schema.dropTable('email_providers').execute()
  await db.schema.dropTable('device_blocks').execute()
  await db.schema.alterTable('devices').dropColumn('static_ip').execute()
}
