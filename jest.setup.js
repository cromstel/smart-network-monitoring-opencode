require('@testing-library/jest-dom')

// Integration tests exercise the real repositories through the shared client
// (lib/db/client.ts), which is MySQL-only since SQLite was removed: it needs
// DB_USER / DB_PASSWORD / DB_NAME and fails at import time naming whichever is
// missing — the same boot-time check the server uses.
//
// There is deliberately no database default here. A previous version pointed
// DB_FILE at an in-memory SQLite so a suite could run without a database, and
// that branch no longer exists; leaving a default would make a suite look
// configured while it could not connect. Instead, DB-backed suites import the
// client lazily and skip themselves with a message when the variables are
// absent, which keeps `npm test` green on a machine with no database (the same
// intent as `passWithNoTests` in jest.config.js). CI supplies the variables
// through the docker-compose environment.

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