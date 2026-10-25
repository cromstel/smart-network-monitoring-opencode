import { Kysely, MysqlDialect } from 'kysely'
import type { MysqlPool } from 'kysely'
import type { DB } from './schema'

const g = globalThis as unknown as { __db?: Kysely<DB> }

/**
 * Reads a required connection variable, failing with a message that names it.
 *
 * `mysql2` accepts `undefined` for every one of these and defers the failure to
 * the first query, where it surfaces as an opaque protocol or authentication
 * error. Failing here instead says which variable is missing while the process
 * is still starting.
 */
function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `It is required when DB_CLIENT=mysql — see .env.example.`
    )
  }
  return value
}

function createMysql(): Kysely<DB> {
  const { createPool } = require('mysql2') as typeof import('mysql2')
  const pool = createPool({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
    database: requiredEnv('DB_NAME'),
    connectionLimit: 10,
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  }) as unknown as MysqlPool
  return new Kysely<DB>({
    dialect: new MysqlDialect({
      pool,
    }),
  })
}

/**
 * DB_CLIENT names the *driver*, not the server.
 *
 * 'mysql' selects Kysely's MysqlDialect over the mysql2 driver. The deployed
 * server is MariaDB 12.3, reached through exactly that dialect, because the two
 * speak the same protocol. Nothing here needs changing to run against MariaDB,
 * and nothing here means "MySQL the product" -- it is the config key's name.
 *
 * The distinction is worth stating because the app talks to MariaDB while every
 * variable, type and function is called 'mysql', and that reads like a mistake
 * until you know the wire protocol is shared.
 */
function create(): Kysely<DB> {
  // SQLite removed — only MySQL (MariaDB via mysql2 dialect) is supported.
  return createMysql()
}

/// Exactly one pool per process. The globalThis cache is what stops Next.js
/// dev hot-reload from opening a new pool on every file save (AUDIT.md A-08).
export const db = g.__db ?? create()
if (process.env.NODE_ENV !== 'production') g.__db = db