import { z } from 'zod'

const booleanFromEnv = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === undefined ? undefined : v === 'true')

const envSchema = z.object({
  DB_CLIENT: z.enum(['sqlite', 'mysql']).default('sqlite'),
  DB_FILE: z.string().default('./data/dev.db'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  // Identity values, not secrets. Kept as defaults so a local MySQL works out
  // of the box; both are overridden by the environment in any real deployment.
  DB_NAME: z.string().default('home_monitor'),
  DB_USER: z.string().default('monitor'),
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
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  ENABLE_DB_MIGRATIONS_ON_BOOT: booleanFromEnv,
})

export type AppConfig = z.infer<typeof envSchema>

const MIN_SECRET_LENGTH = 32

/**
 * A weak secret in production is a real breach, not a style nit: the session
 * secret signs nothing but is stored alongside sessions, and the encryption
 * key protects router credentials. Refuse to boot rather than accept either.
 */
function assertProductionSecretStrength(candidate: Record<string, unknown>, isProduction: boolean): void {
  if (!isProduction) return

  const problems: string[] = []

  for (const name of ['SESSION_SECRET', 'ENCRYPTION_KEY'] as const) {
    const value = candidate[name]
    if (typeof value !== 'string' || value.trim().length < MIN_SECRET_LENGTH) {
      problems.push(
        `${name} must be at least ${MIN_SECRET_LENGTH} characters in production ` +
          `(generate with: openssl rand -hex ${MIN_SECRET_LENGTH})`
      )
    }
  }

  // DB_PASSWORD is the one secret that previously had no production guard. It
  // defaults to '' because SQLite needs no password, so a production deploy
  // that sets DB_CLIENT=mysql and forgets DB_PASSWORD started up, connected
  // with an empty password, and failed at the first query with whatever the
  // driver happened to say. Now it fails immediately, naming the variable.
  const dbPassword = candidate.DB_PASSWORD
  if (candidate.DB_CLIENT === 'mysql' && (typeof dbPassword !== 'string' || !dbPassword.trim())) {
    problems.push('DB_PASSWORD is required in production when DB_CLIENT=mysql')
  }

  if (problems.length > 0) {
    throw new Error(`Insecure production configuration: ${problems.join('; ')}`)
  }
}

/**
 * Parses and validates the environment once. Fails fast with a message
 * naming every missing or malformed variable — never a runtime `undefined`
 * three layers deep. Security secrets are only required in production.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env
): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development').toLowerCase()
  const isProduction = nodeEnv === 'production'

  const candidate = {
    ...env,
    SESSION_SECRET: env.SESSION_SECRET?.trim() || (isProduction ? undefined : 'dev-only-insecure-session-secret'),
    ENCRYPTION_KEY: env.ENCRYPTION_KEY?.trim() || (isProduction ? undefined : 'dev-only-insecure-encryption-key'),
  }

  assertProductionSecretStrength(candidate, isProduction)

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