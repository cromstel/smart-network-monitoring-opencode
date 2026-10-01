/**
 * The default landing destination after a successful sign-in.
 */
export const DEFAULT_REDIRECT = '/'

/**
 * Returns true when `value` is safe to hand to a client-side navigation as a
 * redirect target.
 *
 * The login page reads `?redirect=` and passes it to `router.replace()`. That
 * value is attacker-controllable: anyone can send a link to
 * `/auth/login?redirect=https://example.invalid` and, once the victim signs in
 * on that page, the client navigates to the attacker's origin with the session
 * cookie in hand. Measured, not assumed: a login cycle with
 * `redirect=https://evil.example.com/pwn` produced an off-origin navigation
 * (`chrome-error://chromewebdata/`, because that host does not resolve — a real
 * one would render).
 *
 * The rule is the same one these frameworks use: only same-origin *paths* are
 * allowed, so the value must start with a single `/`.
 *
 * Rejected, with the reason each matters:
 *   - `//evil.example.com`  protocol-relative, an authority, not a path. Next
 *                           happens to normalise this today; relying on that is
 *                           how an open redirect survives a dependency bump.
 *   - `/\\evil.example.com` backslashes are normalised to `//` by some
 *                           browsers, so they are an authority too.
 *   - `https://…`, `http://…` absolute URLs, and any other scheme such as
 *                           `javascript:` or `data:`.
 *   - empty or missing, which falls back to the default rather than resolving
 *           to something ambiguous.
 */
export function isSafeRedirect(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (!value.startsWith('/')) return false
  // Must be a path, not `//host` or `/\host`.
  if (value.startsWith('//')) return false
  if (value.startsWith('/\\')) return false
  // `//` is caught above, but a leading backslash is normalised to `/` by some
  // clients, so treat it as an authority attempt too.
  if (value.startsWith('\\')) return false
  return true
}

/**
 * Coerces a `?redirect=` search param into a destination that is safe to
 * navigate to, falling back to `fallback` when the value is missing or unsafe.
 *
 * Returning a known-good path is deliberate: callers can navigate to the result
 * unconditionally instead of re-deriving whether it is trustworthy.
 */
export function safeRedirect(value: unknown, fallback: string = DEFAULT_REDIRECT): string {
  return isSafeRedirect(value) ? value : fallback
}
