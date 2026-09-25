import { db } from '@/lib/db/client'
import { getConfig } from '@/lib/config'
import { logger } from '@/lib/utils/logger'
import { sql } from 'kysely'

function hourTrunc(col: string): ReturnType<typeof sql> {
  const cfg = getConfig()
  if (cfg.DB_CLIENT === 'mysql') {
    return sql`DATE_FORMAT(${sql.raw(col)}, '%Y-%m-%d %H:00:00')`
  }
  return sql`strftime('%Y-%m-%d %H:00:00', ${sql.raw(col)})`
}

function hourStart(col: string): ReturnType<typeof sql> {
  const cfg = getConfig()
  if (cfg.DB_CLIENT === 'mysql') {
    return sql`DATE_FORMAT(${sql.raw(col)}, '%Y-%m-%d %H:00:00')`
  }
  return sql`strftime('%Y-%m-%d %H:00:00', ${sql.raw(col)})`
}

export async function rollupHourly(): Promise<number> {
  const cfg = getConfig()
  const now = new Date()
  const hourStartDt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() - 1, 0, 0))
  const hourEndDt = new Date(hourStartDt.getTime() + 3600_000)

  logger.info({ hourStart: hourStartDt.toISOString() }, 'starting hourly rollup')

  const hourStartCol = hourStart('timestamp')

  const result = await db
    .insertInto('bandwidth_hourly')
    .expression(
      db
        .selectFrom('bandwidth_metrics')
        .select([
          'device_id',
          hourStartCol.as('hour_start'),
          db.fn.avg('upload_speed').as('avg_upload_speed'),
          db.fn.avg('download_speed').as('avg_download_speed'),
          db.fn.max('upload_speed').as('peak_upload_speed'),
          db.fn.max('download_speed').as('peak_download_speed'),
          sql`SUM(CAST(${sql.raw('upload_total')} AS UNSIGNED))`.as('bytes_uploaded'),
          sql`SUM(CAST(${sql.raw('download_total')} AS UNSIGNED))`.as('bytes_downloaded'),
          db.fn.count('id').as('sample_count'),
        ])
        .where('timestamp', '>=', hourStartDt.toISOString())
        .where('timestamp', '<', hourEndDt.toISOString())
        .groupBy('device_id')
        .groupBy(hourStartCol)
    )
    .onConflict((oc) =>
      oc.columns(['device_id', 'hour_start']).doUpdateSet({
        avg_upload_speed: (eb) => eb.ref('excluded.avg_upload_speed'),
        avg_download_speed: (eb) => eb.ref('excluded.avg_download_speed'),
        peak_upload_speed: (eb) => eb.ref('excluded.peak_upload_speed'),
        peak_download_speed: (eb) => eb.ref('excluded.peak_download_speed'),
        bytes_uploaded: (eb) => eb.ref('excluded.bytes_uploaded'),
        bytes_downloaded: (eb) => eb.ref('excluded.bytes_downloaded'),
        sample_count: (eb) => eb.ref('excluded.sample_count'),
        created_at: new Date().toISOString(),
      })
    )
    .execute()

  const count = Number(result[0]?.numInsertedOrUpdatedRows ?? 0)
  logger.info({ count, hourStart: hourStartDt.toISOString() }, 'hourly rollup completed')
  return count
}