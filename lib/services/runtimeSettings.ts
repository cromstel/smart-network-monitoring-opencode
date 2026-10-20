import { db } from '@/lib/db/client'
import { getConfig } from '@/lib/config'
import { logger } from '@/lib/utils/logger'

/**
 * Runtime-effective settings.
 *
 * Before this module existed, the settings page was a write-only surface: every
 * value it persisted (`network_subnet`, `scan_interval_seconds`,
 * `data_retention_days`, the three notification toggles) was stored in
 * `user_settings` and then ignored, because the scheduler, the scan job and the
 * prune job all read `getConfig()` — i.e. the *environment*. An operator could
 * change the subnet, watch the form report success, and the scanner would keep
 * sweeping the old subnet forever.
 *
 * The resolution rule below is the whole point:
 *
 *   - `user_settings` is **per user**, but scanning is a *global* background
 *     job. So there is no single user whose settings are "the" settings.
 *   - The environment is the deployment's floor. The first row wins as the
 *     global override, ordered deterministically by `user_id` so the answer
 *     does not change between calls when several admins have saved settings.
 *
 * That keeps the behaviour honest and explains itself: an env-configured
 * deployment with no settings rows behaves exactly as before, and the moment an
 * admin saves the form the running system actually changes.
 */

export interface EffectiveScanSettings {
  /** Subnet handed to the scanner. */
  subnet: string
  /** Delay between scan cycles, in seconds. */
  scanIntervalSeconds: number
  /** Source of `subnet` / `scanIntervalSeconds`, for logging and tests. */
  source: 'settings' | 'env'
}

export interface EffectiveRetentionSettings {
  dataRetentionDays: number
  source: 'settings' | 'env'
}

interface SettingsOverrideRow {
  scan_interval_seconds: number | bigint
  data_retention_days: number | bigint
  network_subnet: string
}

/**
 * The first row by `user_id`. Deliberately not `LIMIT 1` without an ORDER BY:
 * SQLite is free to return any row, and a test that asserts a resolved value
 * must not depend on insertion order.
 */
async function findSettingsOverride(): Promise<SettingsOverrideRow | null> {
  const row = await db
    .selectFrom('user_settings')
    .select(['scan_interval_seconds', 'data_retention_days', 'network_subnet'])
    .orderBy('user_id', 'asc')
    .limit(1)
    .executeTakeFirst()

  return (row as SettingsOverrideRow | undefined) ?? null
}

/**
 * Never throws: a settings read must not be able to stop the scanner. On any
 * failure the environment value is used and the reason is logged, so a broken
 * table degrades to the previous behaviour instead of no scanning at all.
 */
export async function getEffectiveScanSettings(): Promise<EffectiveScanSettings> {
  const cfg = getConfig()
  const env: EffectiveScanSettings = {
    subnet: cfg.NETWORK_SUBNET,
    scanIntervalSeconds: cfg.SCAN_INTERVAL_SECONDS,
    source: 'env',
  }

  try {
    const row = await findSettingsOverride()
    if (!row) return env

    return {
      subnet: row.network_subnet || env.subnet,
      scanIntervalSeconds: Number(row.scan_interval_seconds) || env.scanIntervalSeconds,
      source: 'settings',
    }
  } catch (err) {
    logger.error({ err }, 'failed to read scan settings, falling back to environment')
    return env
  }
}

export async function getEffectiveRetentionSettings(): Promise<EffectiveRetentionSettings> {
  const cfg = getConfig()
  const env: EffectiveRetentionSettings = {
    dataRetentionDays: cfg.DATA_RETENTION_DAYS,
    source: 'env',
  }

  try {
    const row = await findSettingsOverride()
    if (!row) return env

    return {
      dataRetentionDays: Number(row.data_retention_days) || env.dataRetentionDays,
      source: 'settings',
    }
  } catch (err) {
    logger.error({ err }, 'failed to read retention settings, falling back to environment')
    return env
  }
}
