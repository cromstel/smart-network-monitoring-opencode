import { aggregateLast24Hours } from '@/lib/db/repositories/scanHistoryRepository'
import { notifyAdminGroup } from './adminNotifier'
import { buildSummaryMessage } from './scanSummaryMessage'
import { logger } from '@/lib/utils/logger'

export { buildSummaryMessage } from './scanSummaryMessage'

/**
 * The daily scan summary (08:00, scheduled by `instrumentation.node.ts`).
 *
 * Two distinct messages, because two distinct problems:
 *
 *  - **Zero scans in 24h** — the scheduler is down, the process restarted
 *    into a broken state, or migrations left the table unwritable. This is the
 *    most actionable signal the whole system can produce: scanning is the
 *    heartbeat, and silence means it stopped. It is an `error`/`high`.
 *
 *  - **Some scans ran** — a routine rollup: how many, how they went, how many
 *    devices the network held. `info`/`low`, because a healthy day should not
 *    read as an emergency.
 *
 * The immediate `scan.completed` event (see `scanJob`) covers a scan that
 * fails *right now*; this job is the "did the day look normal?" view that a
 * per-scan alert cannot give.
 */
export async function sendDailyScanSummary(now = new Date()): Promise<void> {
  const summary = await aggregateLast24Hours(now)

  if (summary.totalScans === 0) {
    logger.warn('daily scan summary: no scans recorded in the last 24 hours')
    await notifyAdminGroup({
      title: 'Network scanning stopped',
      message:
        'No network scans have been recorded in the last 24 hours. The scanner may be disabled, the scheduler may not be running, or the database may be unreachable.',
      type: 'error',
      priority: 'high',
    })
    return
  }

  await notifyAdminGroup({
    title: 'Daily scan summary',
    message: buildSummaryMessage(summary),
    type: 'info',
    priority: 'low',
  })

  logger.info(
    {
      totalScans: summary.totalScans,
      successCount: summary.successCount,
      partialCount: summary.partialCount,
      failedCount: summary.failedCount,
    },
    'daily scan summary sent'
  )
}
