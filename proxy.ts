import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { validateSession } from '@/lib/services/authService'
import { logger } from '@/lib/utils/logger'

/**
 * Content Security Policy, generated per request.
 *
 * This lived in `next.config.ts` as a static header until the theme audit
 * showed what a static `script-src 'self'` costs: Next.js injects its own
 * hydration bootstrap as **inline** scripts (the `self.__next_f` flight
 * chunks), so every page load logged
 *
 *   "Executing inline script violates the following Content Security Policy
 *    directive 'script-src 'self''"
 *
 * and, because the bootstrap never ran,
 *
 *   "Invariant: Expected a request ID to be defined for the document via
 *    self.__next_r"
 *
 * — a page error on every route, not just a console warning. The theme
 * bootstrap component (`components/ThemeScript.tsx`) is inline too, for the
 * same reason: it has to execute before first paint, so an external file would
 * be both a flash of dark and, for the auth pages, an extra round trip.
 *
 * The nonce is the way out. Per Next.js's CSP guidance:
 *
 *   - the middleware generates one nonce per request;
 *   - it is passed down as the `x-nonce` **request** header, which Next
 *     forwards to its own inline scripts automatically;
 *   - it is published in the **response** header's `script-src` directive;
 *   - `'strict-dynamic'` goes with it, because the scripts Next injects after
 *     the initial HTML (the lazy flight chunks) are created with
 *     `document.createElement` and inherit trust from the nonced parent —
 *     without it, deep-linked pages would hydrate while a navigation did not.
 *
 * The nonce value itself is never logged and never appears in an exception
 * message: a CSP violation report would echo it, and this header is not
 * report-only.
 */
function contentSecurityPolicy(nonce: string): string {
  // React's development build reconstructs stack frames with `eval`. It says so
  // in the console message this suppresses ("React will never use eval() in
  // production mode"), which is also why the keyword is added *only* outside
  // production: the dev server and the built app cannot share one policy.
  const evalInDev = process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"

  return [
    "default-src 'self'",
    // `'self'` stays for the parser-inserted bundles; the nonce and
    // strict-dynamic cover everything Next adds after parse.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${evalInDev}`,
    // Styles stay `'unsafe-inline'`: the app is plain CSS (Tailwind emits
    // stylesheets, not style tags), but Recharts and Radix set inline `style`
    // attributes and `<style>` injection, and a hash per element is not
    // maintainable here. Style injection cannot read the DOM, so the exposure
    // this allows is limited to markup tampering via a compromised dependency.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join('; ')
}

/**
 * A base64 nonce: no quote, no base64 special set collisions, and long enough
 * that a guess is not a factor. One per response, so a captured value cannot
 * be replayed against a later request.
 */
function generateNonce(): string {
  return Buffer.from(randomUUID()).toString('base64')
}

// Next.js 16 renamed the `middleware` convention to `proxy` and fixed its
// runtime to Node.js. This file was middleware.ts through Next.js 15, where
// `export const runtime = 'nodejs'` was required to opt in; the export is gone
// because the runtime is no longer configurable.
//
// The Node.js runtime is load-bearing here, not incidental: validateSession
// opens the application database through the same repository layer the routes
// use. An edge runtime could not reach it.

// Authentication pages live under /auth/*. The API routes keep their own
// /api/* namespace and are listed separately below.
const ALLOWED_PATHS = [
  '/auth/login',
  '/auth/setup',
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/setup',
]

function isAllowed(path: string): boolean {
  return ALLOWED_PATHS.some((p) => path === p || path.startsWith(p + '/'))
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  const nonce = generateNonce()
  const csp = contentSecurityPolicy(nonce)

  // Every render below has to carry the nonce, so it goes on the *request*
  // headers (what the app reads through `headers()`) as well as the response.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

  if (isAllowed(path)) {
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    })
    response.headers.set('Content-Security-Policy', csp)
    return response
  }

  const token = request.cookies.get('session')?.value
  if (!token) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('redirect', path)
    logger.warn({ path }, 'unauthenticated access denied')
    const response = NextResponse.redirect(loginUrl)
    response.headers.set('Content-Security-Policy', csp)
    return response
  }

  const result = await validateSession(token)
  if (!result) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('redirect', path)
    logger.warn({ path }, 'invalid session')
    const response = NextResponse.redirect(loginUrl)
    response.headers.set('Content-Security-Policy', csp)
    response.cookies.set('session', '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 })
    return response
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })
  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('x-user-id', result.user.id)
  response.headers.set('x-user-role', result.user.role)
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|avif|svg|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
