require('@testing-library/jest-dom')

// Integration tests exercise the real repositories through the shared client
// (lib/db/client.ts). Point it at an in-memory SQLite by default so no test
// touches ./data/dev.db. CI flips DB_CLIENT=mysql (docker-compose.yml) and
// the same specs then run against MySQL — TODO.md B-14.
process.env.DB_FILE = process.env.DB_FILE ?? ':memory:'
if (process.env.RUN_MYSQL_TESTS === '1' && !process.env.DB_CLIENT) {
  process.env.DB_CLIENT = 'mysql'
}