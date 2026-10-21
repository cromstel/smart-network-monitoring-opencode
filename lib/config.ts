import { z } from 'zod'
import { appPort } from './config/ports'

const booleanFromEnv = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === undefined ? undefined : v === 'true')

const envSchema = z.object({
  DB_CLIENT: z.enum(['sqlite', 'mysql']).default('sqlite'),
  DB_FILE: z.string().default('./data/dev.db'),
  DB_HOST: z.string().default('localhost'),
  // The MySQL default port. Overridable, and `mysql` itself is a fixed protocol
  // fact rather than a project choice, so one documented default is correct.
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  // Connection identity is **never** defaulted. A schema name and a user name
  // are configuration the operator owns; a built-in `home_monitor` / `monitor`
  // pair meant a deployment that forgot them silently connected as a user
  // somebody else may have created, to the wrong database. Both are optional in
  // the schema because SQLite ignores them entirely — `lib/db/client.ts`
  // requires them when DB_CLIENT=mysql.
  DB_NAME: z.string().optional(),
  DB_USER: z.string().optional(),
  // Never defaulted to a usable value. An empty default is the safe one, and
  // production with DB_CLIENT=mysql now refuses to start without one.
  DB_PASSWORD: z.string().default(''),
  SESSION_SECRET: z.string(), 
  ENCRYPTION_KEY: z.string(),
  NETWORK_SUBNET: z.string().default('192.168.1.0/24'),
  SCANNER_MODE: z.enum(['simulated', 'arp', 'asus']).default('simulated'),
  SCAN_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(3600).default(30),
  DATA_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // The port the server listens on. `.default(appPort())`, not a literal, so
  // this and `lib/config/ports.ts` cannot disagree about the default — they did
  // briefly (3000 here, 9000 there), which is the exact drift the ports module
  // exists to prevent. `ports.ts` remains the single place the number is
  // written down; this only validates whatever it resolves to.
  PORT: z.coerce.number().int().min(1).max(65535).default(appPort()),
  // Required with no default: the product's identity is per-deployment
  // configuration, and a fallback would let a white-labelled instance ship
  // under another product's name. Validated here so a missing value fails at
  // boot with a named variable rather than at the first render.
  //
  // This is the *boot* check. The request-time reader is `appName()` in
  // `lib/config/app.ts`, which must re-read the environment on every call
  // because build workers and tests swap it mid-process — so it cannot use the
  // cached value this schema produces. The two implement the same rule
  // (present, trimmed, non-empty) on purpose, in two places for two jobs;
  // `lib/__tests__/appIdentity.test.ts` asserts they accept and reject the
  // same values so the duplication cannot silently drift.
  //
  // `.trim().min(1)` rather than `.min(1)`: a value of `'   '` is four
  // characters and would pass a bare length check, then render as a blank
  // `<title>` and an empty sidebar heading — the failure looking like a CSS
  // problem instead of a configuration one.
  APP_NAME: z.string().trim().min(1),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  ENABLE_DB_MIGRATIONS_ON_BOOT: booleanFromEnv,
})

export type AppConfig = z.infer<typeof envSchema>

const MIN_SECRET_LENGTH = 32

/**
 * Secret strength, checked in **every** environment.
 *
 * A weak secret is a real breach, not a style nit: the encryption key protects
 * stored router credentials, and both are only as safe as their entropy.
 *
 * This used to return early unless `NODE_ENV=production`, on the theory that a
 * development machine need not care. That was wrong for a concrete reason: an
 * environment file is copied from a developer's machine to a staging box to a
 * production host, and a rule enforced only at the last hop does not stop the
 * weak value from travelling — it just delays the failure until a deploy, when
 * the pressure to get the release out is highest. Enforcing it at every boot
 * means the placeholder is rejected on the machine where it was written.
 *
 * The only relaxation is *presence*: nothing has a default. A variable that is
 * absent is still an error everywhere, as is one that is present but too short.
 */
function assertSecretStrength(candidate: Record<string, unknown>): void {
  const problems: string[] = []

  for (const name of ['SESSION_SECRET', 'ENCRYPTION_KEY'] as const) {
    const value = candidate[name]
    if (typeof value !== 'string' || value.trim().length < MIN_SECRET_LENGTH) {
      problems.push(
        `${name} must be at least ${MIN_SECRET_LENGTH} characters ` +
          `(generate with: openssl rand -hex ${MIN_SECRET_LENGTH})`
      )
    }
  }

  if (problems.length > 0) {
    throw new Error(`Insecure configuration: ${problems.join('; ')}`)
  }
}

/**
 * Production-only guards: values that are legitimately optional locally but
 * must be present on a real deployment.
 */
function assertProductionRequirements(candidate: Record<string, unknown>, isProduction: boolean): void {
  if (!isProduction) return

  if (candidate.DB_CLIENT !== 'mysql') return

  // Every one of these used to have a usable default, so a production deploy
  // that set DB_CLIENT=mysql and forgot any of them started up, connected as
  // whatever the default happened to be, and failed — or worse, succeeded
  // against the wrong database. They are reported together so one boot fixes
  // all of them rather than three restarts.
  const missing: string[] = []

  for (const name of ['DB_NAME', 'DB_USER', 'DB_PASSWORD'] as const) {
    const value = candidate[name]
    if (typeof value !== 'string' || !value.trim()) missing.push(name)
  }

  if (missing.length > 0) {
    throw new Error(
      `Insecure production configuration: ${missing.join(', ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} required when DB_CLIENT=mysql`
    )
  }
}

/**
 * Parses and validates the environment once. Fails fast with a message
 * naming every missing or malformed variable — never a runtime `undefined`
 * three layers deep.
 *
 * **No secret has a default, in any environment.** An earlier version
 * substituted literal `dev-only-insecure-*` strings whenever a secret was
 * absent outside production, which meant a developer's session cookies and
 * router credentials were encrypted under a key that is committed to this
 * repository — and published the moment the repo is. A default that is usable
 * is not a default, it is a shared secret. Both are now required everywhere;
 * `.env.example` and `README` say how to generate them.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env
): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development').toLowerCase()
  const isProduction = nodeEnv === 'production'

  const candidate = { ...env }

  assertSecretStrength(candidate)
  assertProductionRequirements(candidate, isProduction)

  const parsed = envSchema.safeParse(candidate)
  if (!parsed.success) {
    const issues = parsed.error.issues
    const missing = issues
      .filter((i) => i.code === 'invalid_type' && i.received === 'undefined')
      .map((i) => i.path.join('.'))
    const detail = issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    const prefix = missing.length
      ? `Missing required environment variable(s): ${missing.join(', ')}.`
      : 'Invalid environment:'
    throw new Error(`${prefix} ${detail}`)
  }
  return parsed.data
}

let cached: AppConfig | undefined

export function getConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  if (!cached) cached = loadConfig(env)
  return cached
}