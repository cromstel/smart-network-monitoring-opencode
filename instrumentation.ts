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

/**
 * Contains client disconnects so they cannot take the process down.
 *
 * A browser closing the dashboard tab aborts the /api/events request. Node
 * reports that asynchronously, from the HTTP layer, as
 *
 *   uncaughtException: [Error: aborted] { code: 'ECONNRESET' }
 *
 * and nothing between it and the process listens for it, so the server dies.
 * This was not theoretical: the Playwright run reproduced it every time, and the
 * same abort happens whenever a real user closes the tab or navigates away. The
 * E2E cascade it produced — nine tests failing with "element not found" and no
 * mention of a crash — is why it stayed hidden.
 *
 * Catching errors around enqueue() in the route handler is not sufficient, and
 * demonstrably was not: the abort does not surface where the write happens.
 *
 * The filter is deliberately narrow. Only a client-disconnect signature is
 * swallowed; everything else is logged and rethrown so real bugs still crash
 * loudly. A blanket uncaughtException handler would turn every future fault
 * into a silent mystery, which is worse than the crash.
 */
function isClientDisconnect(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: string; message?: string; name?: string }
  if (e.code === 'ECONNRESET' || e.code === 'EPIPE') return true
  return e.name === 'AbortError' || e.message === 'aborted'
}

function installDisconnectGuard(): void {
  const g = globalThis as unknown as { __disconnectGuard?: boolean }
  if (g.__disconnectGuard) return
  g.__disconnectGuard = true

  // A capture callback, not process.on / prependListener.
  //
  // Node invokes *every* listener for uncaughtException -- returning early from
  // one does not stop the others. Next.js installs its own handler during server
  // bootstrap that logs and exits, so no amount of prepending could suppress it;
  // the capture callback is the only mechanism that takes exclusive control.
  //
  // This is not specific to SSE: it was reproduced with the EventSource disabled
  // entirely. A browser that navigates away or closes a tab aborts whatever HTTP
  // requests happen to be in flight, and Node reports that asynchronously, out of
  // the HTTP layer, with nothing between it and the process. Catching errors
  // around the SSE write could not have helped, because the abort does not
  // surface where the write happens. The visible symptom was nine Playwright
  // tests failing with "element not found" and no mention of a crash.
  //
  // The filter is narrow on purpose: only a client-disconnect signature is
  // swallowed, and everything else is logged and rethrown so genuine faults still
  // take the process down. A blanket catch would turn every future bug into a
  // silent mystery, which is strictly worse than a crash.
  // Defensive on both counts: the @types/node in this project predates these
  // APIs, and Next.js evaluates route modules during `next build` in a context
  // where `process` is a partial shim. If the hook is missing there is nothing
  // to install, and the build must not fail because of it.
  const proc = process as unknown as {
    setUncaughtExceptionCaptureCallback?: (fn: (err: unknown) => void) => void
    setUnhandledRejectionCaptureCallback?: (fn: (reason: unknown) => void) => void
  }

  if (typeof proc.setUncaughtExceptionCaptureCallback === 'function') {
    proc.setUncaughtExceptionCaptureCallback((err: unknown) => {
      if (isClientDisconnect(err)) {
        logger.debug({ err }, 'client disconnected; ignoring')
        return
      }
      logger.error({ err }, 'uncaught exception; rethrowing')
      throw err
    })
  }

  if (typeof proc.setUnhandledRejectionCaptureCallback === 'function') {
    proc.setUnhandledRejectionCaptureCallback((reason: unknown) => {
      if (isClientDisconnect(reason)) {
        logger.debug({ err: reason }, 'client disconnect rejection; ignoring')
        return
      }
      logger.error({ err: reason }, 'unhandled rejection; rethrowing')
      throw reason
    })
  }

  logger.info('client-disconnect guard installed')
}

/**
 * Installed at module load, not inside register().
 *
 * Node runs uncaughtException handlers in registration order, and Next.js
 * installs its own during server bootstrap. Calling this from register() was
 * too late: the server logged the abort and exited before the guard was ever
 * consulted. Importing this module is the earliest point the application
 * controls, so the guard is armed before the http server exists.
 */
if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV !== 'test') {
  installDisconnectGuard()
}

/** Next.js boot hook. */
export function register(): void {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NODE_ENV === 'test') return
  installDisconnectGuard()
  startScheduler()
}
