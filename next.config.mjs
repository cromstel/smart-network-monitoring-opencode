/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['bcryptjs', 'better-sqlite3', 'mysql2', 'kysely', 'node-cron', 'oui-data', 'bindings', 'file-uri-to-path'],

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