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

/**
 * Buckets an ISO-8601 timestamp column to its hour, per dialect.
 *
 * This used to be `DATE_FORMAT(col, '%Y-%m-%d %H:00:00')` on MySQL and
 * `strftime(...)` on SQLite, which assumed the column held a real DATETIME.
 * It holds ISO-8601 text ("2026-09-29T15:05:00.000Z"), so MySQL coerced the
 * value and rejected it:
 *
 *   Incorrect datetime value: '2026-09-29T15:05:00.000Z'
 *   for column `bandwidth_metrics`.`timestamp`
 *
 * — failing the hourly rollup outright on MySQL. Truncating the text is both
 * correct and simpler: the first 13 characters of an ISO-8601 UTC string are
 * "YYYY-MM-DDTHH", and because the format is fixed-width and UTC those sort
 * lexicographically in the same order as chronologically. SUBSTR is spelled the
 * same in both dialects, so this is now a single expression rather than a
 * branch. See lib/db/migrator.ts for why these columns are text.
 */
function hourTrunc(col: 'timestamp'): RawBuilder<unknown> {
  return sql`SUBSTR(${sql.ref(col)}, 1, 13)`
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
          // The window is exactly one hour wide, so every row in the group
          // belongs to the hour we already know. Writing the known ISO value
          // avoids rebuilding the string in SQL, and keeps hour_start in the
          // same ISO-8601 form as every other timestamp column.
          sql<string>`${start.toISOString()}`.as('hour_start'),
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
  //
  // Both the clause and the "value that would have been inserted" reference are
  // dialect-specific:
  //   SQLite: on conflict (cols) do update set col = excluded.col
  //   MySQL:  on duplicate key update col = values(col)
  // MySQL has no `excluded` pseudo-table; `values(col)` is its equivalent and is
  // accepted by MariaDB and MySQL 5.7/8.0 alike. Re-aggregating an hour is the
  // normal case after a restart, so this path runs for real, not just at edges.
  const ROLLUP_COLUMNS = [
    'avg_upload_speed',
    'avg_download_speed',
    'peak_upload_speed',
    'peak_download_speed',
    'bytes_uploaded',
    'bytes_downloaded',
    'sample_count',
  ] as const

  const result = isMysql()
    ? await insert
        .onDuplicateKeyUpdate(
          Object.fromEntries(
            ROLLUP_COLUMNS.map((col) => [col, sql`values(${sql.ref(col)})`])
          ) as never
        )
        .executeTakeFirst()
    : await insert
        .onConflict((oc) =>
          oc
            .columns(['device_id', 'hour_start'])
            .doUpdateSet(
              Object.fromEntries(
                ROLLUP_COLUMNS.map((col) => [
                  col,
                  (eb: { ref: (c: string) => unknown }) => eb.ref(`excluded.${col}`),
                ])
              ) as never
            )
        )
        .executeTakeFirst()

  const count = Number((result as { numInsertedOrUpdatedRows?: bigint | number })?.numInsertedOrUpdatedRows ?? 0)
  logger.info({ count, hourStart: start.toISOString() }, 'hourly rollup completed')
  return count
}
