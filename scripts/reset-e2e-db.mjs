// Resets the throwaway E2E schema so each run starts from a known state.
//
// This runs in the Playwright webServer command, i.e. BEFORE `next start`
// opens a connection. That ordering is the whole point:
//
//   - Previously the seed ran from an e2e/global-setup.ts that playwright.config.ts
//     never referenced, so it never executed at all. The database was created
//     empty by the server's boot migrations, every login returned
//     "Invalid email or password", and 16 of 16 specs failed. The suite had
//     never actually worked, locally or in CI.
//   - Dropping the tables the server is already using mid-run is worse than
//     not resetting at all: the server would hold a connection pooling rows
//     out of tables that no longer exist.
//
// So the reset has to happen first, not during setup. Kept as a script rather
// than an inline shell command because `rm -f` does not exist on Windows, and
// because the reset needed a driver anyway — there is no file to delete.
//
// ## Why it drops tables instead of the schema
//
// `DROP DATABASE` / `CREATE DATABASE` needs privileges the application user does
// not have: `monitor` is granted on specific schemas only (see doc/MEMORY.md), so
// the schema is emptied table by table. It is also why a missing schema is
// reported as a setup step rather than created — see the check in main().
//
// ## Why the reset is not a migration rollback
//
// `createMigrator(db).migrateTo(NO_MIGRATIONS)` half-runs on a real schema:
// migration 006's `down` emits SQL MariaDB rejects ("...near '' at line 1"),
// which leaves the tables above 006 in place and the bookkeeping rows below it
// gone — neither empty nor migrated, and every later step fails on
// "table already exists".
//
// Rebuilding *up* from nothing hits the same wall from the other side, and this
// one is not the reset's fault: 001 declares `devices.id` as `varchar(36)` while
// 008 declares `device_blocks.device_id` as `uuid`, and a foreign key can only be
// formed between columns of the same type, so MariaDB answers
//
//   Can't create table `home_monitor_test`.`device_blocks`
//   (errno: 150 "Foreign key constraint is incorrectly formed")
//
// which names neither column nor cause. Every table has to agree on the type of
// a key that joins, so a schema cannot be rebuilt from nothing while the two
// migrations disagree. Declaring 008's keys as `varchar(36)`, like every other
// table, is what fixes it — in lib/db/, which this script deliberately does not
// work around. Until then the failure is reported as itself instead of being
// papered over, because a reset that silently produced half a schema would be
// worse than one that says the migration set is inconsistent.

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(REPO, 'scripts', 'reset-e2e-db.cjs'))

const mysql = require('mysql2/promise')

/** The e2e schema, and never a reserved one. */
const schema = (process.env.DB_NAME ?? '').trim() || 'home_monitor_e2e'

/**
 * Missing credentials are reported here rather than by the driver.
 *
 * `lib/db/client.ts` refuses to start without these and names the variable, but
 * that happens at *import* time — an unhandled throw with a stack trace rather
 * than a line saying what to set. Checking first keeps the message the same
 * without the crash.
 */
const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) {
    console.error(`Missing required environment variable: ${name} (see .env.example).`)
    process.exit(1)
  }
  return value
}

const connection = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  user: required('DB_USER'),
  password: required('DB_PASSWORD'),
}

/**
 * The app's own modules are TypeScript, and a `.mjs` script is plain Node with
 * no transpiler. Requiring them through ts-node's CommonJS hook is the same
 * mechanism `npm run db:migrate` uses, so the reset runs against exactly the
 * client and migrator the server will use rather than a second, quieter copy.
 *
 * Imported after the environment is validated, so a missing variable is the
 * message above rather than the client's own throw on an incomplete import.
 */
require('ts-node').register({
  project: path.join(REPO, 'tsconfig.node.json'),
  transpileOnly: true,
})

const { RESERVED_DB_NAMES } = require(path.join(REPO, 'lib/config/app.ts'))
const { db } = require(path.join(REPO, 'lib/db/client.ts'))
const { runMigrations } = require(path.join(REPO, 'lib/db/migrator.ts'))

if (RESERVED_DB_NAMES.some((reserved) => reserved.toLowerCase() === schema.toLowerCase())) {
  console.error(
    `Refusing to reset schema "${schema}" — that looks like the live database. ` +
      'Point DB_NAME at a throwaway schema (default: home_monitor_e2e).'
  )
  process.exit(1)
}

async function listTables(conn) {
  const [rows] = await conn.query(
    'SELECT table_name AS n FROM information_schema.tables ' +
      'WHERE table_schema = DATABASE() AND table_type = ? ORDER BY table_name',
    ['BASE TABLE']
  )
  return rows.map((r) => r.n)
}

/**
 * Drops every table in the target schema, bookkeeping included.
 *
 * The migrator's own tables have to go with the rest: leaving `kysely_migration`
 * behind would make a clean schema look already migrated, and `migrateToLatest`
 * would then report success having created nothing.
 *
 * `information_schema.tables` is queried rather than `db.introspection`, because
 * Kysely's introspection deliberately omits the two migrator tables — dropping
 * only what it lists is exactly how a "reset" silently skips them.
 *
 * `SET FOREIGN_KEY_CHECKS = 0` is needed because MariaDB refuses to drop a
 * parent table while a child still references it. It is a *session* variable
 * and Kysely hands each statement to whichever pooled connection is free, so
 * setting it through `db` would not cover the drop: everything here runs on one
 * dedicated connection instead.
 */
async function dropAllTables(name) {
  const conn = await mysql.createConnection({ ...connection, database: name })
  try {
    const tables = await listTables(conn)
    if (tables.length === 0) return []

    await conn.query('SET FOREIGN_KEY_CHECKS = 0')
    for (const table of tables) {
      await conn.query('DROP TABLE IF EXISTS ??', [table])
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1')

    return tables
  } finally {
    await conn.end()
  }
}

async function main() {
  // The schema itself has to exist before anything can be dropped from it, and
  // the app user cannot create one (see the note above). Reported as a setup
  // step rather than attempted: `CREATE DATABASE IF NOT EXISTS` fails with an
  // access error on this user, and "it tried and could not" is not more useful
  // than "it must exist".
  const probe = await mysql.createConnection(connection)
  const [schemas] = await probe.query(
    'SELECT schema_name AS n FROM information_schema.schemata WHERE schema_name = ?',
    [schema]
  )
  await probe.end()

  if (schemas.length === 0) {
    console.error(
      `Schema "${schema}" does not exist. Create it as a user with the privilege, ` +
        `grant it to ${connection.user}, then re-run: `
    )
    console.error(`  CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4;`)
    process.exit(1)
  }

  console.log(`Resetting schema ${schema} ...`)

  // Reported before the migration runs, so a schema that is already empty and a
  // schema that just lost everything are distinguishable in the log even when
  // what follows fails.
  const dropped = await dropAllTables(schema)
  if (dropped.length === 0) {
    console.log('  no tables present; rebuilding from the migrations')
  } else {
    console.log(`  dropped ${dropped.length} table(s): ${dropped.join(', ')}`)
  }

  const applied = await runMigrations()
  console.log(`  recreated ${applied.length} table(s) by migration`)
  console.log(`Reset ${schema}`)
}

/**
 * Names the cause of the one failure this script cannot fix.
 *
 * MariaDB's errno 150 does not say which constraint or which column, so the
 * message the server gives is a dead end for anyone reading the log. The
 * mismatch this repo actually has is a join key declared `varchar(36)` in one
 * migration and `uuid` in another, and saying so turns a dead end into a
 * file:line.
 */
function explain(err) {
  const text = err instanceof Error ? err.message : String(err)
  if (/errno: 150|Foreign key constraint/i.test(text)) {
    return (
      `${text}\n` +
      'A foreign key can only join columns of the same type, so a migration set\n' +
      'that declares one key as varchar(36) and another as uuid cannot rebuild a\n' +
      'schema from nothing. Check lib/db/migrations/008 against 001 and make the\n' +
      'key types agree.'
    )
  }
  return text
}

main()
  .then(async () => {
    await db.destroy()
  })
  .catch(async (err) => {
    console.error('reset failed:', explain(err))
    process.exitCode = 1
    await db.destroy().catch(() => {})
  })
