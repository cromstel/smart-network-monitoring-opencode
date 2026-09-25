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
  DB_NAME: z.string().default('home_monitor'),
  DB_USER: z.string().default('monitor'),
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