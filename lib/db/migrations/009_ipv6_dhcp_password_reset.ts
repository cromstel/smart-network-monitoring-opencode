import { Kysely, sql } from 'kysely'

/**
 * IPv6 addresses on devices, DHCP leases, and password reset tokens.
 *
 * ## Idempotency (same contract as 008)
 *
 * Every statement is guarded by an existence check so the migration can be
 * re-run after a partial failure. Kysely records a migration only when it
 * completes, so a half-applied run leaves no record — the next run must be
 * able to continue from where it left off without hitting
 * `Duplicate column name` / `Table already exists`.
 *
 * ## Column conventions
 *
 * - IDs: `varchar(36)` (not MariaDB `uuid`) — MySQL 8.4 has no UUID type, and
 *   the application passes `randomUUID()` strings everywhere.
 * - Timestamps: `varchar(64)` ISO-8601 UTC strings (not `datetime`) —
 *   MariaDB rejects the ISO-8601-with-milliseconds format as a DATETIME
 *   value; text columns make both engines agree and sort correctly as text.
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
  // F-14: IPv6 address column on devices.
  if (!(await columnExists(db, 'devices', 'ipv6_address'))) {
    await db.schema
      .alterTable('devices')
      .addColumn('ipv6_address', 'varchar(45)', (col: any) => col.defaultTo(null))
      .execute()
  }

  // F-43: DHCP lease records observed during scans.
  if (!(await tableExists(db, 'dhcp_leases'))) {
    await db.schema
      .createTable('dhcp_leases')
      .addColumn('id', 'varchar(36)', (col: any) => col.primaryKey().notNull())
      .addColumn('device_id', 'varchar(36)', (col: any) => col.notNull().references('devices.id').onDelete('cascade'))
      .addColumn('ip_address', 'varchar(45)', (col: any) => col.notNull())
      .addColumn('mac_address', 'varchar(17)', (col: any) => col.notNull())
      .addColumn('hostname', 'varchar(255)', (col: any) => col.defaultTo(null))
      .addColumn('lease_start', 'varchar(64)', (col: any) => col.notNull())
      .addColumn('lease_end', 'varchar(64)', (col: any) => col.defaultTo(null))
      .addColumn('is_active', 'integer', (col: any) => col.defaultTo(1).notNull())
      .addColumn('created_at', 'varchar(64)', (col: any) => col.notNull())
      .execute()
  }

  await createIndexIfMissing(db, 'idx_dhcp_leases_device', 'dhcp_leases', ['device_id'])
  await createIndexIfMissing(db, 'idx_dhcp_leases_active', 'dhcp_leases', ['is_active'])
  await createIndexIfMissing(db, 'idx_dhcp_leases_mac', 'dhcp_leases', ['mac_address'])

  // F-64: one-time password reset tokens (email flow).
  if (!(await tableExists(db, 'password_reset_tokens'))) {
    await db.schema
      .createTable('password_reset_tokens')
      .addColumn('id', 'varchar(36)', (col: any) => col.primaryKey().notNull())
      .addColumn('user_id', 'varchar(36)', (col: any) => col.notNull().references('users.id').onDelete('cascade'))
      .addColumn('token_hash', 'varchar(128)', (col: any) => col.notNull())
      .addColumn('expires_at', 'varchar(64)', (col: any) => col.notNull())
      .addColumn('used_at', 'varchar(64)', (col: any) => col.defaultTo(null))
      .addColumn('created_at', 'varchar(64)', (col: any) => col.notNull())
      .execute()
  }

  await createIndexIfMissing(db, 'idx_pwd_reset_user', 'password_reset_tokens', ['user_id'])
  await createIndexIfMissing(db, 'idx_pwd_reset_token', 'password_reset_tokens', ['token_hash'])
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('password_reset_tokens').ifExists().execute()
  await db.schema.dropTable('dhcp_leases').ifExists().execute()
  if (await columnExists(db, 'devices', 'ipv6_address')) {
    await db.schema.alterTable('devices').dropColumn('ipv6_address').execute()
  }
}
