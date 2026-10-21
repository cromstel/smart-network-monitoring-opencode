import type { NextConfig } from 'next'

import { devAllowedOrigins } from './lib/config/ports'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['bcryptjs', 'better-sqlite3', 'mysql2', 'kysely', 'node-cron', 'oui-data', 'bindings', 'file-uri-to-path'],

  /**
   * Hosts the dev server accepts requests from.
   *
   * `next dev` binds every interface so a phone on the same network can load
   * the app, but Next.js rejects a request whose `Host` header it does not
   * recognise — a DNS-rebinding guard, because a dev server on `0.0.0.0` is
   * reachable from any page the developer has open. Without this list, opening
   * the dev build from a device at `http://192.168.x.y:<port>` is refused and
   * the page never hydrates, which reads as a broken build rather than a
   * blocked origin.
   *
   * The list lives in `lib/config/ports.ts` beside the port it applies to, so
   * the host and the port a device must type are decided in one place. It is
   * surfaced here rather than inlined because `DEV_ALLOWED_ORIGINS` is
   * read at config-load time, which is exactly when Next.js needs it.
   *
   * Applied only when the dev server is running: production ignores this key,
   * and the guard it relaxes is not in play there.
   */
  allowedDevOrigins: devAllowedOrigins(),

  /**
   * Compatibility redirects for paths that used to exist.
   *
   * Every entry here is a path that resolved before and no longer does. They
   * exist so an old bookmark, or a link pasted from an older version, keeps
   * working instead of hitting a 404. None of them is part of the current route
   * design; once no plausible client holds an old link they can all be deleted
   * in one go.
   *
   * Redirects rather than duplicate pages, deliberately. A second route serving
   * the same component is a second thing to keep in sync, and these are being
   * retired, not maintained.
   */
  async redirects() {
    return [
      // Authentication pages moved under /auth/*.
      { source: '/login', destination: '/auth/login', permanent: true },
      { source: '/setup', destination: '/auth/setup', permanent: true },

      // The overview became the landing page at '/', so '/overview' was retired.
      { source: '/overview', destination: '/', permanent: true },
    ]
  },
}

export default nextConfig
