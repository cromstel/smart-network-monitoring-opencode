import { Kysely, sql } from 'kysely'

/**
 * Audit log and device notes tables.
 *
 * ## Idempotency
 *
 * Every statement is guarded by an existence check, following the same
 * pattern as migration 008, so the migration can be re-run after a partial
 * failure.
 *
 * ## Column conventions
 *
 * - IDs: `varchar(36)` — MySQL 8.4 has no UUID type.
 * - Timestamps: `varchar(64)` ISO-8601 UTC strings — MariaDB rejects ISO-8601
 *   with milliseconds as DATETIME.
 */

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

export async function up(db: Kysely<any>): Promise<void> {
  // Audit log table — records admin actions for security and accountability.
  if (!(await tableExists(db, 'audit_logs'))) {
    await db.schema
      .createTable('audit_logs')
      .addColumn('id', 'varchar(36)', (col: any) => col.primaryKey().notNull())
      .addColumn('user_id', 'varchar(36)', (col: any) => col.notNull().references('users.id').onDelete('cascade'))
      .addColumn('action', 'varchar(100)', (col: any) => col.notNull())
      .addColumn('resource_type', 'varchar(50)', (col: any) => col.notNull())
      // No `.nullable()` here: Kysely has no such method (the stack trace was
      // `col.nullable is not a function`), and a column is nullable unless
      // `.notNull()` is called. The call made this migration fail on every
      // fresh database, which is why it went unnoticed — local schemas had
      // already created the table, so this branch was skipped.
      .addColumn('resource_id', 'varchar(36)')
      .addColumn('old_values', 'text')
      .addColumn('new_values', 'text')
      .addColumn('ip_address', 'varchar(45)')
      .addColumn('user_agent', 'varchar(255)')
      .addColumn('created_at', 'varchar(64)', (col: any) => col.notNull())
      .execute()
  }

  await createIndexIfMissing(db, 'idx_audit_logs_user', 'audit_logs', ['user_id'])
  await createIndexIfMissing(db, 'idx_audit_logs_action', 'audit_logs', ['action'])
  await createIndexIfMissing(db, 'idx_audit_logs_created', 'audit_logs', ['created_at'])

  // Device notes table — user notes attached to devices for documentation.
  if (!(await tableExists(db, 'device_notes'))) {
    await db.schema
      .createTable('device_notes')
      .addColumn('id', 'varchar(36)', (col: any) => col.primaryKey().notNull())
      .addColumn('device_id', 'varchar(36)', (col: any) => col.notNull().references('devices.id').onDelete('cascade'))
      .addColumn('user_id', 'varchar(36)', (col: any) => col.notNull().references('users.id').onDelete('cascade'))
      .addColumn('note', 'text', (col: any) => col.notNull())
      .addColumn('created_at', 'varchar(64)', (col: any) => col.notNull())
      .addColumn('updated_at', 'varchar(64)', (col: any) => col.notNull())
      .execute()
  }

  await createIndexIfMissing(db, 'idx_device_notes_device', 'device_notes', ['device_id'])
  await createIndexIfMissing(db, 'idx_device_notes_user', 'device_notes', ['user_id'])
}

async function createIndexIfMissing(
  db: Kysely<any>,
  index: string,
  table: string,
  columns: string[]
): Promise<void> {
  // Kysely's createIndexIfNotExists is not available on Kysely<any>, so we
  // check information_schema directly, same as migration 008.
  const idxResult = await sql<{ n: number | string }>`
    select count(*) as n from information_schema.statistics
    where table_schema = database() and table_name = ${lit(table)} and index_name = ${lit(index)}
  `.execute(db)
  if (Number(idxResult.rows[0]?.n ?? 0) > 0) return

  await db.schema.createIndex(index).on(table).columns(columns).execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('device_notes').ifExists().execute()
  await db.schema.dropTable('audit_logs').ifExists().execute()
}
