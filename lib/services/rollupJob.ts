import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db/client'
import { logger } from '@/lib/utils/logger'
import { sql, type RawBuilder } from 'kysely'

/**
 * Nightly/hourly rollup from `bandwidth_metrics` into `bandwidth_hourly`.
 *
 * History over 24h reads the aggregate table rather than the raw rows, which
 * is what keeps a 30-day query fast (ARCHITECTURE.md §9). If this job is
 * broken, that guarantee silently disappears, so it is covered by
 * `lib/services/__tests__/jobs.test.ts`, including the double-run case.
 *
 * Two dialect differences are handled explicitly:
 *   - truncating a timestamp to the hour (`DATE_FORMAT` vs `strftime`),
 *   - summing a byte counter that is stored as TEXT. `CAST(... AS UNSIGNED)`
 *     is MySQL-only and `CAST(... AS INTEGER)` is SQLite-only, so the cast is
 *     chosen from `DB_CLIENT` rather than assumed.
 */

function isMysql(): boolean {
  return process.env.DB_CLIENT === 'mysql'
}

/** Truncates a timestamp column to the start of its hour, per dialect. */
function hourTrunc(col: 'timestamp'): RawBuilder<unknown> {
  if (isMysql()) {
    return sql`DATE_FORMAT(${sql.ref(col)}, '%Y-%m-%d %H:00:00')`
  }
  return sql`strftime('%Y-%m-%d %H:00:00', ${sql.ref(col)})`
}

/** Sums a TEXT-typed byte counter, per dialect. */
function sumCounter(col: 'upload_total' | 'download_total'): RawBuilder<string> {
  if (isMysql()) {
    return sql<string>`CAST(SUM(CAST(${sql.ref(col)} AS UNSIGNED)) AS CHAR)`
  }
  return sql<string>`CAST(SUM(CAST(${sql.ref(col)} AS INTEGER)) AS TEXT)`
}

function previousHourWindow(): { start: Date; end: Date } {
  const now = new Date()
  const start = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours() - 1,
      0,
      0,
      0
    )
  )
  return { start, end: new Date(start.getTime() + 3_600_000) }
}

export async function rollupHourly(): Promise<number> {
  const { start, end } = previousHourWindow()
  const nowIso = new Date().toISOString()
  const bucket = hourTrunc('timestamp')

  logger.info({ hourStart: start.toISOString() }, 'starting hourly rollup')

  // One row per (device, hour) per run. `id` and `created_at` are supplied
  // here because the select-expression below does not produce them.
  const insert = db
    .insertInto('bandwidth_hourly')
    .columns([
      'id',
      'device_id',
      'hour_start',
      'avg_upload_speed',
      'avg_download_speed',
      'peak_upload_speed',
      'peak_download_speed',
      'bytes_uploaded',
      'bytes_downloaded',
      'sample_count',
      'created_at',
    ])
    .expression(
      db
        .selectFrom('bandwidth_metrics')
        .select([
          sql<string>`${randomUUID()}`.as('id'),
          'device_id',
          bucket.as('hour_start'),
          db.fn.avg('upload_speed').as('avg_upload_speed'),
          db.fn.avg('download_speed').as('avg_download_speed'),
          db.fn.max('upload_speed').as('peak_upload_speed'),
          db.fn.max('download_speed').as('peak_download_speed'),
          sumCounter('upload_total').as('bytes_uploaded'),
          sumCounter('download_total').as('bytes_downloaded'),
          db.fn.count('id').as('sample_count'),
          sql<string>`${nowIso}`.as('created_at'),
        ])
        .where('timestamp', '>=', start.toISOString())
        .where('timestamp', '<', end.toISOString())
        .groupBy('device_id')
        .groupBy(bucket)
    )

  // Re-running for an hour already aggregated must update, not duplicate.
  const result = await insert
    .onConflict((oc) =>
      oc.columns(['device_id', 'hour_start']).doUpdateSet({
        avg_upload_speed: (eb) => eb.ref('excluded.avg_upload_speed'),
        avg_download_speed: (eb) => eb.ref('excluded.avg_download_speed'),
        peak_upload_speed: (eb) => eb.ref('excluded.peak_upload_speed'),
        peak_download_speed: (eb) => eb.ref('excluded.peak_download_speed'),
        bytes_uploaded: (eb) => eb.ref('excluded.bytes_uploaded'),
        bytes_downloaded: (eb) => eb.ref('excluded.bytes_downloaded'),
        sample_count: (eb) => eb.ref('excluded.sample_count'),
      })
    )
    .executeTakeFirst()

  const count = Number((result as { numInsertedOrUpdatedRows?: bigint | number })?.numInsertedOrUpdatedRows ?? 0)
  logger.info({ count, hourStart: start.toISOString() }, 'hourly rollup completed')
  return count
}
