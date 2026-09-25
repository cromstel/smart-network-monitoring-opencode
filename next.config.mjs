/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['bcryptjs', 'better-sqlite3', 'mysql2', 'kysely', 'node-cron', 'oui-data'],
}