/**
 * The E2E accounts, in one place.
 *
 * The seed and the specs must agree on these values or the suite signs in with
 * a credential that was never written. Historically each carried its own copy
 * of the same six strings, and `scripts/fcp.ts` carried a third — three
 * definitions of one fact, which is a loop waiting for someone to update two of
 * them. Everything now imports from here.
 *
 * ## Why these are not secrets
 *
 * They are throwaway credentials for a database that is recreated before every
 * run (`scripts/reset-e2e-db.mjs`), served by `next start` on a loopback port,
 * holding only synthetic devices. Nothing reachable with them exists outside
 * the test process. They are still overridable by environment so a run that
 * needs different values — CI matrix, a locked-down sandbox — does not have to
 * edit source.
 *
 * ## These are deliberately *not* the same as production
 *
 * `scripts/seed.ts` (development) creates no account at all unless
 * `ADMIN_EMAIL`/`ADMIN_PASSWORD` are supplied, and refuses to write a
 * known-password account into the developer's real database. The values below
 * must never be usable against a real deployment, which is why they are
 * namespaced `e2e-*@example.com`.
 */

export type E2ERole = 'ADMIN' | 'MEMBER' | 'VIEWER'

export interface E2EAccount {
  readonly email: string
  readonly password: string
  readonly name: string
  readonly role: E2ERole
}

/**
 * Non-secret fallbacks, derived from the environment when present.
 *
 * Read lazily through functions rather than as module-level constants: this
 * module is imported by both a ts-node script (where `process.env` is complete
 * before import) and the Playwright process (where the webServer `env` block is
 * applied by Playwright, not inherited). A module-level read would capture
 * whichever ordering happened to occur first.
 */
function envOr(key: string, fallback: string): string {
  const value = process.env[key]?.trim()
  return value && value.length > 0 ? value : fallback
}

export function e2eAccounts(): readonly E2EAccount[] {
  return [
    {
      email: envOr('E2E_ADMIN_EMAIL', 'e2e-admin@example.com'),
      password: envOr('E2E_ADMIN_PASSWORD', 'E2e-Admin-Pass-2026'),
      name: 'E2E Admin',
      role: 'ADMIN',
    },
    {
      email: envOr('E2E_MEMBER_EMAIL', 'e2e-member@example.com'),
      password: envOr('E2E_MEMBER_PASSWORD', 'E2e-Member-Pass-2026'),
      name: 'E2E Member',
      role: 'MEMBER',
    },
    {
      email: envOr('E2E_VIEWER_EMAIL', 'e2e-viewer@example.com'),
      password: envOr('E2E_VIEWER_PASSWORD', 'E2e-Viewer-Pass-2026'),
      name: 'E2E Viewer',
      role: 'VIEWER',
    },
  ]
}

export function e2eAccount(role: E2ERole): E2EAccount {
  const account = e2eAccounts().find((a) => a.role === role)
  if (!account) {
    // Unreachable while the tuple above covers every role, but a throw is the
    // right failure: silently returning `undefined` would surface as a
    // "cannot read email of undefined" in whichever spec ran first.
    throw new Error(`No E2E account defined for role ${role}`)
  }
  return account
}
