/**
 * Dev server launcher that reads the port from .env.local and passes it to
 * `next dev --port <port>`.
 *
 * Next.js's `next dev` does not honour the `PORT` environment variable from
 * `.env.local`/`.env` — it only accepts `--port` as a CLI flag. This script
 * bridges that gap by reading `PORT` from `.env.local` at startup and
 * forwarding it to the dev server, so the port stays defined in one place
 * (`.env.local`) rather than hardcoded in a script or package.json.
 *
 * If `PORT` is absent or malformed, falls back to Next.js's default (3000).
 */

import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ENV_PATH = join(__dirname, '..', '.env.local')
const DEFAULT_PORT = 3000

function readPortFromEnvLocal() {
  let raw
  try {
    raw = readFileSync(ENV_PATH, 'utf-8')
  } catch {
    // No .env.local — let Next.js use its default.
    return DEFAULT_PORT
  }

  const match = raw.match(/^PORT=(.+)$/m)
  if (!match) return DEFAULT_PORT

  const value = match[1].trim().replace(/^"|"$/, '').replace(/^'|'$/, '')
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.warn(
      `[dev-port] Invalid PORT in .env.local: ${JSON.stringify(value)}. ` +
        `Using Next.js default (${DEFAULT_PORT}).`,
    )
    return DEFAULT_PORT
  }
  return port
}

const port = readPortFromEnvLocal()
console.log(`[dev-port] Starting next dev on port ${port} (from .env.local)`)

execSync(`next dev --port ${port}`, { stdio: 'inherit' })
