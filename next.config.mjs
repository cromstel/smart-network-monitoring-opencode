/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['bcryptjs', 'better-sqlite3', 'mysql2', 'kysely', 'node-cron', 'oui-data'],

  // The authentication pages moved under /auth/*. Anything that still points at
  // the old paths is redirected rather than left to 404 — bookmarks, and any
  // link pasted from an older version, should keep working.
  //
  // /login and /setup are NOT in the middleware allowlist any more, so an
  // unauthenticated visitor to them is bounced to /auth/login by the middleware
  // before a route is ever resolved. These redirects cover the remaining case,
  // an authenticated user following a stale link, and are permanent so browsers
  // cache them.
  //
  // Remove these once no plausible client holds an old bookmark; they are a
  // compatibility shim, not part of the route design.
  async redirects() {
    return [
      { source: '/login', destination: '/auth/login', permanent: true },
      { source: '/setup', destination: '/auth/setup', permanent: true },
    ]
  },
}

export default nextConfig