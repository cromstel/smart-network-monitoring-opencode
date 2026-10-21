require('@testing-library/jest-dom')

// Integration tests exercise the real repositories through the shared client
// (lib/db/client.ts). Point it at an in-memory SQLite by default so no test
// touches ./data/dev.db. CI flips DB_CLIENT=mysql (docker-compose.yml) and
// the same specs then run against MySQL — TODO.md B-14.
process.env.DB_FILE = process.env.DB_FILE ?? ':memory:'
if (process.env.RUN_MYSQL_TESTS === '1' && !process.env.DB_CLIENT) {
  process.env.DB_CLIENT = 'mysql'
}

// `lib/config.ts` requires SESSION_SECRET and ENCRYPTION_KEY in every
// environment, because a built-in development fallback meant every developer
// and every CI run encrypted with the same literal key. Tests that reach
// `getConfig()` (the scanners, the router config route) therefore need values.
//
// These are generated per process, not literals: a fixed string here would
// reintroduce exactly the committed-key problem the requirement removes, and
// nothing in the suite asserts a specific value. Set before any module that
// calls `getConfig()` is required, which is why this file is a `setupFiles`
// entry rather than per-suite boilerplate.
const crypto = require('node:crypto')
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? crypto.randomBytes(32).toString('hex')
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? crypto.randomBytes(32).toString('hex')

// `APP_NAME` is required by `appName()`, which the layout and the login page
// render. A test that mounts either would otherwise throw on a missing
// variable rather than failing on the behaviour under test.
process.env.APP_NAME = process.env.APP_NAME ?? 'Test Network Monitor'