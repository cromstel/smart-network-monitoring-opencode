import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3100)
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // The seeded accounts' passwords are throwaway values written in
  // e2e/fixtures.ts and mirrored from scripts/e2e-seed.ts — never real secrets.
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // Reset and seed BEFORE `next start`. The server opens the SQLite file
        // on first query and then holds it, so a reset performed during test
        // setup is both too late and, on Windows, impossible. See
        // scripts/reset-e2e-db.mjs.
        command: `npm run db:reset:e2e && npm run db:seed:e2e && npm run start -- --port ${PORT}`,
        url: `${baseURL}/api/health`,
        // Never reuse. The webServer command resets and seeds the database
        // before starting, so a reused server skips that entirely and serves
        // whatever database it happened to be holding. The results are then
        // silently wrong rather than obviously broken: a run against a stale
        // server reported 6 of 17 specs and took three times as long, with
        // no error explaining why. Slower local iteration, correct results.
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          NODE_ENV: 'production',
          DB_CLIENT: 'sqlite',
          DB_FILE: './data/e2e.db',
          SCANNER_MODE: 'simulated',
          SCAN_INTERVAL_SECONDS: '30',
          LOG_LEVEL: 'warn',
          ENABLE_DB_MIGRATIONS_ON_BOOT: 'true',
          // Every spec signs in, all from one address, so the production limit
          // of five attempts per quarter hour would fail the suite on the sixth
          // test. This raises it for the throwaway test server only.
          LOGIN_RATE_LIMIT_MAX: '500',
          // `next start` implies NODE_ENV=production, and the app refuses to
          // boot in production without these two. Supplying throwaway values
          // here keeps `npm run test:e2e` working on a clean checkout instead
          // of failing with an unrelated-looking crypto error. CI overrides
          // them with its own. Test-only, never a real secret.
          SESSION_SECRET:
            process.env.SESSION_SECRET ?? 'e2e-session-secret-not-for-production-000000',
          ENCRYPTION_KEY:
            process.env.ENCRYPTION_KEY ?? 'e2e-encryption-key-not-for-production-0000000000',
        },
      },
})
