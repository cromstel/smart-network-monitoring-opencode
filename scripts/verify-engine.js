#!/usr/bin/env node
/**
 * Fails unless the database we just connected to really is the engine this
 * matrix row is for.
 *
 * Why this exists, and why it is a script rather than an inline `node -e`:
 * the check used to be inline and duplicated across two jobs, and it was wrong
 * in both copies. It tested `VERSION().includes('mysql')`, but MySQL 8.4
 * reports `VERSION()` = `8.4.11` — the word "MySQL" does not appear in it. So
 * the check failed for MySQL, the MySQL job refused to run its own tests, and
 * the run was reported as a MySQL failure rather than as the coverage gap it
 * was. MariaDB self-identifies (`12.3.3-MariaDB-ubu2404`), which is why that
 * leg always worked. Two copies of a check that cannot pass for one of the two
 * engines is how B-14 came to be ticked "both green" with one leg never run.
 *
 * The rules:
 *   1. The engine must identify itself somewhere in `VERSION()` **or**
 *      `@@version_comment`, because MySQL names itself only in the comment
 *      ("MySQL Community Server - GPL") and MariaDB names itself in both.
 *   2. It must *not* be the other engine. MariaDB and MySQL speak the same
 *      wire protocol through the same driver, so proving the positive is not
 *      enough on its own.
 *
 * Usage: node scripts/verify-engine.js <mariadb|mysql>
 * Exits non-zero on a mismatch, with the observed values printed.
 */

const EXPECT = (process.argv[2] || '').toLowerCase()

if (EXPECT !== 'mariadb' && EXPECT !== 'mysql') {
  console.error(`usage: node scripts/verify-engine.js <mariadb|mysql>  (got "${process.argv[2]}")`)
  process.exit(2)
}

const mysql = require('mysql2/promise')

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  })

  const [rows] = await c.query('SELECT VERSION() v, @@version_comment c')
  const [coll] = await c.query('SELECT @@collation_server co')
  await c.end()

  const version = String(rows[0].v)
  const comment = String(rows[0].c || '')
  const collation = String(coll[0].co)

  console.log('engine   :', version)
  console.log('comment  :', comment)
  console.log('collation:', collation)

  // Both strings, because either may carry the name depending on the engine.
  const haystack = `${version} ${comment}`.toLowerCase()

  if (!haystack.includes(EXPECT)) {
    console.error(`REFUSING: expected this to be ${EXPECT}, and neither VERSION() nor version_comment says so.`)
    process.exit(1)
  }

  const other = EXPECT === 'mariadb' ? 'mysql' : 'mariadb'
  if (haystack.includes(other)) {
    console.error(`REFUSING: this is ${other}, not ${EXPECT}. Both speak the same protocol.`)
    process.exit(1)
  }

  console.log(`confirmed engine: ${EXPECT}`)
}

main().catch((e) => {
  console.error('connect failed:', e.code || e.message)
  process.exit(1)
})
