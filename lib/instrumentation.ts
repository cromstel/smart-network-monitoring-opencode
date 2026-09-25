import cron from 'node-cron'
import { getConfig } from '@/lib/config'
import { logger } from '@/lib/utils/logger'
import { scanOnce } from '@/lib/services/scanJob'
import { rollupHourly } from '@/lib/services/rollupJob'
import { pruneData } from '@/lib/services/pruneJob'

let scanTask: cron.ScheduledTask | null = null
let rollupTask: cron.ScheduledTask | null = null
let pruneTask: cron.ScheduledTask | null = null

function scheduleScan(): void {
  const cfg = getConfig()
  const cronExpr = `*/${cfg.SCAN_INTERVAL_SECONDS} * * * * *`
  if (scanTask) scanTask.stop()
  scanTask = cron.schedule(cronExpr, async () => {
    try {
      await scanOnce()
    } catch (err) {
      logger.error({ err }, 'scan job failed')
    }
  })
  logger.info({ cron: cronExpr }, 'scan job scheduled')
}

function scheduleRollup(): void {
  if (rollupTask) rollupTask.stop()
  rollupTask = cron.schedule('0 * * * *', async () => {
    try {
      await rollupHourly()
    } catch (err) {
      logger.error({ err }, 'rollup job failed')
    }
  })
  logger.info({ cron: '0 * * * *' }, 'hourly rollup job scheduled')
}

function schedulePrune(): void {
  if (pruneTask) pruneTask.stop()
  pruneTask = cron.schedule('0 3 * * *', async () => {
    try {
      await pruneData()
    } catch (err) {
      logger.error({ err }, 'prune job failed')
    }
  })
  logger.info({ cron: '0 3 * * *' }, 'nightly prune job scheduled')
}

export function startScheduler(): void {
  scheduleScan()
  scheduleRollup()
  schedulePrune()
  logger.info('scheduler started')
}

export function stopScheduler(): void {
  scanTask?.stop()
  rollupTask?.stop()
  pruneTask?.stop()
  scanTask = rollupTask = pruneTask = null
  logger.info('scheduler stopped')
}

export function getSchedulerStatus(): {
  scan: string | null
  rollup: string | null
  prune: string | null
} {
  return {
    scan: scanTask ? 'running' : null,
    rollup: rollupTask ? 'running' : null,
    prune: pruneTask ? 'running' : null,
  }
}