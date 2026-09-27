import cron, { type ScheduledTask } from 'node-cron'
import { getConfig } from '@/lib/config'
import { logger } from '@/lib/utils/logger'
import { scanOnce } from '@/lib/services/scanJob'
import { rollupHourly } from '@/lib/services/rollupJob'
import { pruneData } from '@/lib/services/pruneJob'
import { runMigrations } from '@/lib/db/migrator'

/**
 * Scheduler entry point.
 *
 * Next.js calls `register()` once per server process on boot. The `globalThis`
 * guard matters: without it `next dev` re-evaluates this module on every hot
 * reload and each reload stacks another set of cron tasks, so a long dev
 * session silently multiplies database writes.
 */

interface SchedulerState {
  started: boolean
  scanTimer: NodeJS.Timeout | null
  rollupTask: ScheduledTask | null
  pruneTask: ScheduledTask | null
  scanInFlight: boolean
}

const g = globalThis as unknown as { __scheduler?: SchedulerState }

function state(): SchedulerState {
  if (!g.__scheduler) {
    g.__scheduler = {
      started: false,
      scanTimer: null,
      rollupTask: null,
      pruneTask: null,
      scanInFlight: false,
    }
  }
  return g.__scheduler
}

/**
 * Scanning uses a self-rescheduling timer rather than a cron expression.
 * `SCAN_INTERVAL_SECONDS` is configurable over 30–3600, and cron cannot express
 * an interval that does not divide 60 (e.g. 45s). A timer handles every value.
 */
function scheduleScan(): void {
  const cfg = getConfig()
  const intervalMs = cfg.SCAN_INTERVAL_SECONDS * 1000
  const s = state()

  const runScan = async () => {
    if (s.scanInFlight) {
      logger.warn('previous scan still running, skipping this tick')
    } else {
      s.scanInFlight = true
      try {
        await scanOnce()
      } catch (err) {
        logger.error({ err }, 'scan job failed')
      } finally {
        s.scanInFlight = false
      }
    }
    if (state().scanTimer) scheduleScan()
  }

  s.scanTimer = setTimeout(runScan, intervalMs)
  // Do not hold the event loop open purely for the timer.
  s.scanTimer.unref?.()
  logger.info({ intervalSeconds: cfg.SCAN_INTERVAL_SECONDS }, 'scan job scheduled')
}

function scheduleRollup(): void {
  const s = state()
  if (s.rollupTask) s.rollupTask.stop()
  s.rollupTask = cron.schedule('0 * * * *', async () => {
    try {
      await rollupHourly()
    } catch (err) {
      logger.error({ err }, 'rollup job failed')
    }
  })
  logger.info({ cron: '0 * * * *' }, 'hourly rollup job scheduled')
}

function schedulePrune(): void {
  const s = state()
  if (s.pruneTask) s.pruneTask.stop()
  s.pruneTask = cron.schedule('0 3 * * *', async () => {
    try {
      await pruneData()
    } catch (err) {
      logger.error({ err }, 'prune job failed')
    }
  })
  logger.info({ cron: '0 3 * * *' }, 'nightly prune job scheduled')
}

export function startScheduler(): void {
  const s = state()
  if (s.started) {
    logger.info('scheduler already running, skipping duplicate start')
    return
  }
  s.started = true

  try {
    const cfg = getConfig()
    if (cfg.ENABLE_DB_MIGRATIONS_ON_BOOT) {
      runMigrations()
        .then(() => logger.info('migrations applied on boot'))
        .catch((err) => logger.error({ err }, 'boot migrations failed'))
    }
  } catch (err) {
    logger.error({ err }, 'boot configuration invalid; scheduler not started')
    s.started = false
    return
  }

  scheduleScan()
  scheduleRollup()
  schedulePrune()
  logger.info('scheduler started')
}

export function stopScheduler(): void {
  const s = state()
  if (s.scanTimer) clearTimeout(s.scanTimer)
  s.scanTimer = null
  s.rollupTask?.stop()
  s.pruneTask?.stop()
  s.rollupTask = s.pruneTask = null
  s.started = false
  logger.info('scheduler stopped')
}

export function getSchedulerStatus(): {
  scan: string | null
  rollup: string | null
  prune: string | null
} {
  const s = state()
  return {
    scan: s.scanTimer ? 'scheduled' : null,
    rollup: s.rollupTask ? 'running' : null,
    prune: s.pruneTask ? 'running' : null,
  }
}

/** Next.js boot hook. */
export function register(): void {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NODE_ENV === 'test') return
  startScheduler()
}
