import { Kysely, sql } from 'kysely'

/**
 * Device blocks, email providers, and vulnerability alerts.
 *
 * ## Why this file looks idempotent
 *
 * The first version of this migration was not. It added `devices.static_ip`
 * and then tried to create `device_blocks`, and the create failed (see the
 * defaults note below). Kysely records a migration only when it *completes*,
 * so the failed attempt left a database holding one table's worth of the
 * change and no record that anything had run. Any re-run then crashed on
 * `Duplicate column name 'static_ip'`.
 *
 * Every statement below is therefore guarded by an existence check, so the
 * migration can be re-run after a partial failure. This is not only about one
 * machine's half-applied state: it is the only way a migration that fails
 * halfway is retryable at all, and this is not the first deploy to have hit
 * the failure.
 *
 * ## Why the timestamps have no database default
 *
 * `defaultTo(sql\`CURRENT_TIMESTAMP\`)` compiles to `default CURRENT_TIMESTAMP`,
 * which MySQL and MariaDB reject on a **varchar** column, and the parenthesised
 * expression form (`default (CURRENT_TIMESTAMP)`) is rejected on this server
 * too. The error this produced was
 *
 *   SQL syntax error ... near 'default (CURRENT_TIMESTAMP) not null'
 *
 * on `create table device_blocks`. Rather than fight the engines, these
 * columns now follow the convention the rest of the schema already uses
 * (`004_alerts_notifications.ts` declares `created_at varchar(64) notNull()`
 * with no default, and the repositories pass `created_at: now` on insert —
 * see `deviceBlockRepository`). One convention, and no per-engine default
 * syntax to maintain.
 *
 * ## Why the keys are `uuid`, not `varchar(36)`
 *
 * The first version declared `device_id`/`user_id`/`created_by` as
 * `varchar(36)`, the same width as the UUID strings the application generates.
 * The deployed schema stores its keys as MariaDB's native `uuid` type
 * (`devices.id`, `users.id` and every sibling FK column), and a foreign key can
 * only be formed between columns of the same type — the inline `references`
 * failed with
 *
 *   Can't create table ... (errno: 150 "Foreign key constraint is incorrectly formed")
 *
 * which names neither column nor cause. The columns follow the family they
 * join instead: `uuid`. The application still passes `randomUUID()` strings,
 * exactly as it does for `users.id`, and the driver reads the column back as
 * text.
 *
 * ## Why the checks query `information_schema`
 *
 * Kysely's own `addColumnIfNotExists` / `createTableIfNotExists` are not
 * available on the builder type this module is handed (`Kysely<any>` erases the
 * builder generics, and the methods are absent on it), so the checks run as
 * plain SQL instead. `information_schema` is dialect-neutral between the two
 * engines this schema targets and needs no privileges beyond the ones the
 * migration already uses.
 */

/** The `col: any` annotations are deliberate: with `Kysely<any>` the column
 *  builder callbacks are not contextually typed, and `strict` rejects an
 *  implicit any. Every column type is asserted inline beside the annotation,
 *  so the annotation itself asserts nothing. */
/** A bound value, so an identifier in the checks is quoted by the driver
 *  rather than concatenated by hand. */
function lit(value: string) {
  return sql.val(value)
}

async function tableExists(db: Kysely<any>, table: string): Promise<boolean> {
  const result = await sql<{ n: number | string }>`
    select count(*) as n from information_schema.tables
    where table_schema = database() and table_name = ${lit(table)}
  `.execute(db)
  return Number(result.rows[0]?.n ?? 0) > 0
}

async function columnExists(db: Kysely<any>, table: string, column: string): Promise<boolean> {
  const result = await sql<{ n: number | string }>`
    select count(*) as n from information_schema.columns
    where table_schema = database() and table_name = ${lit(table)} and column_name = ${lit(column)}
  `.execute(db)
  return Number(result.rows[0]?.n ?? 0) > 0
}

async function indexExists(db: Kysely<any>, table: string, index: string): Promise<boolean> {
  const result = await sql<{ n: number | string }>`
    select count(*) as n from information_schema.statistics
    where table_schema = database() and table_name = ${lit(table)} and index_name = ${lit(index)}
  `.execute(db)
  return Number(result.rows[0]?.n ?? 0) > 0
}

async function createIndexIfMissing(
  db: Kysely<any>,
  index: string,
  table: string,
  columns: string[]
): Promise<void> {
  if (await indexExists(db, table, index)) return
  await db.schema.createIndex(index).on(table).columns(columns).execute()
}

export async function up(db: Kysely<any>): Promise<void> {
  // Add static_ip to devices
  if (!(await columnExists(db, 'devices', 'static_ip'))) {
    await db.schema
      .alterTable('devices')
      .addColumn('static_ip', 'varchar(45)', (col: any) => col.defaultTo(null))
      .execute()
  }

  // Device block rules (admin-controlled site/app blocking)
  if (!(await tableExists(db, 'device_blocks'))) {
    await db.schema
      .createTable('device_blocks')
      .addColumn('id', 'uuid', (col: any) => col.primaryKey().notNull())
      .addColumn('device_id', 'uuid', (col: any) => col.notNull().references('devices.id').onDelete('cascade'))
      .addColumn('website_app', 'varchar(255)', (col: any) => col.notNull())
      .addColumn('is_active', 'integer', (col: any) => col.defaultTo(1).notNull())
      .addColumn('created_by', 'uuid', (col: any) => col.notNull().references('users.id'))
      .addColumn('created_at', 'varchar(64)', (col: any) => col.notNull())
      .execute()
  }

  await createIndexIfMissing(db, 'idx_device_blocks_device', 'device_blocks', ['device_id'])
  await createIndexIfMissing(db, 'idx_device_blocks_website', 'device_blocks', ['website_app', 'is_active'])

  // Email providers config
  if (!(await tableExists(db, 'email_providers'))) {
    await db.schema
      .createTable('email_providers')
      .addColumn('id', 'uuid', (col: any) => col.primaryKey().notNull())
      .addColumn('provider_name', 'varchar(100)', (col: any) => col.notNull())
      .addColumn('smtp_host', 'varchar(255)', (col: any) => col.notNull())
      .addColumn('smtp_port', 'integer', (col: any) => col.notNull())
      .addColumn('smtp_user', 'varchar(255)', (col: any) => col.notNull())
      .addColumn('smtp_pass', 'varchar(255)', (col: any) => col.notNull())
      .addColumn('is_default', 'integer', (col: any) => col.defaultTo(0).notNull())
      .addColumn('created_at', 'varchar(64)', (col: any) => col.notNull())
      .execute()
  }

  await createIndexIfMissing(db, 'idx_email_default', 'email_providers', ['is_default'])

  // Vulnerability alerts
  if (!(await tableExists(db, 'vulnerability_alerts'))) {
    await db.schema
      .createTable('vulnerability_alerts')
      .addColumn('id', 'uuid', (col: any) => col.primaryKey().notNull())
      .addColumn('user_id', 'uuid', (col: any) => col.notNull().references('users.id'))
      .addColumn('device_id', 'uuid', (col: any) => col.references('devices.id').onDelete('cascade'))
      .addColumn('vulnerability_type', 'varchar(100)', (col: any) => col.notNull())
      .addColumn('severity', 'varchar(20)', (col: any) => col.notNull())
      .addColumn('message', 'text', (col: any) => col.notNull())
      .addColumn('is_read', 'integer', (col: any) => col.defaultTo(0).notNull())
      .addColumn('read_at', 'varchar(64)')
      .addColumn('created_at', 'varchar(64)', (col: any) => col.notNull())
      .execute()
  }

  await createIndexIfMissing(db, 'idx_vuln_user', 'vulnerability_alerts', ['user_id'])
  await createIndexIfMissing(db, 'idx_vuln_read', 'vulnerability_alerts', ['is_read'])
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('vulnerability_alerts').ifExists().execute()
  await db.schema.dropTable('email_providers').ifExists().execute()
  await db.schema.dropTable('device_blocks').ifExists().execute()
  if (await columnExists(db, 'devices', 'static_ip')) {
    await db.schema.alterTable('devices').dropColumn('static_ip').execute()
  }
}
