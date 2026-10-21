/**
 * Every port and host the application binds or dials, plus the dev origin
 * allowlist — in one module, with types.
 *
 * ## Why this is a `.ts` module, not a `.mjs` one
 *
 * It used to be split: `ports.mjs` held the implementation and this file was a
 * typed façade re-exporting it, because `next.config.mjs` had to call
 * `devAllowedOrigins()` at config-load time and Next.js's loader for `.mjs`
 * configs did not resolve TypeScript. The split cost more than it saved:
 * `lib/config.ts` importing the `.mjs` put raw ESM into Jest's CJS runtime
 * (SyntaxError: Unexpected token 'export'), the Dockerfile needed an extra
 * `COPY` line for the `.mjs` or the image failed at container start, and two
 * files described one set of rules.
 *
 * Next.js 15+ loads `next.config.ts` natively (the config is transpiled and
 * its relative imports bundled before evaluation), so the `.mjs` half is gone
 * and this module is the only implementation. `next.config.ts` imports it
 * directly; the application imports it through `lib/config.ts`'s façade-free
 * path.
 *
 * ## Why the app port has a default
 *
 * A port is configuration, not a secret, so a documented default is correct —
 * the rule this satisfies is "do not scatter hardcoded ports", not "a port may
 * never have a default". Every value is overridable by environment, and the
 * override is read at call time so a `cross-env PORT=...` preceding a script
 * wins over the parent process.
 */

/** Loopback — tests bind here and dial here. Not `localhost`, which resolves
 * to `::1` first on Windows and would miss a server listening on IPv4. */
export const LOOPBACK = '127.0.0.1'

function portFromEnv(key: string, fallback: number): number {
  const raw = (process.env[key] ?? '').trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    // A malformed port must fail loudly. Falling back silently would start a
    // server on one port while the client dialled another, and the resulting
    // "connection refused" names neither the variable nor the mistake.
    throw new Error(`${key} must be an integer between 1 and 65535 (got ${JSON.stringify(raw)}).`)
  }
  return value
}

/**
 * The application's own port (`next start` / `next dev`).
 *
 * 9000, not the framework's 3000, and overridable by `PORT`. Read per call so
 * a `cross-env PORT=...` preceding a script wins over the parent process.
 */
export function appPort(): number {
  return portFromEnv('PORT', 9000)
}

/** The port the E2E web server binds, and the specs dial. */
export function e2ePort(): number {
  return portFromEnv('E2E_PORT', 3100)
}

/** The port the FCP harness starts its own server on. */
export function fcpPort(): number {
  return portFromEnv('FCP_PORT', e2ePort())
}

/**
 * A full origin for a loopback port. Callers pass the result to `baseURL`,
 * `page.goto` and `fetch`, so the scheme and host are decided once.
 */
export function loopbackOrigin(port: number): string {
  return `http://${LOOPBACK}:${port}`
}

/**
 * Hosts Next.js should accept dev requests from, for testing on real devices.
 *
 * `next dev` binds every interface, but Next.js rejects a request whose `Host`
 * header it does not recognise — a DNS-rebinding guard, because a dev server on
 * `0.0.0.0` is reachable from any page the developer has open. Without this
 * list, loading the dev build from a phone at `http://192.168.x.y:<port>` is
 * refused and the page never hydrates, which reads as a broken build rather
 * than a blocked origin.
 *
 * `DEV_ALLOWED_ORIGINS` is a comma-separated override for anything not covered
 * by the defaults (a LAN IP, a machine name). A bare `*` is rejected: it would
 * accept every origin and defeat the guard this list exists to satisfy.
 */
export function devAllowedOrigins(): string[] {
  const defaults = ['localhost', LOOPBACK, '0.0.0.0']

  const extra = (process.env.DEV_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  if (extra.includes('*')) {
    throw new Error(
      'DEV_ALLOWED_ORIGINS must not contain "*": it would accept every origin. ' +
        'List the hosts you actually load the dev build from.'
    )
  }

  // Deduplicated so an override that repeats a default does not produce a
  // second entry Next.js would warn about.
  return [...new Set([...defaults, ...extra])]
}
