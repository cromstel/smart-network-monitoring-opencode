import { NO_MIGRATIONS } from 'kysely'
import { db } from './client'
import { createMigrator } from './migrator'
import { logger } from '../utils/logger'

async function main(): Promise<void> {
  const shouldRollBack = process.argv.includes('--down')
  const migrator = createMigrator(db)

  const result = shouldRollBack
    ? await migrator.migrateTo(NO_MIGRATIONS)
    : await migrator.migrateToLatest()

  if (result.error) {
    logger.error({ err: result.error }, 'migration failed')
    process.exitCode = 1
  } else {
    const applied = result.results ?? []
    logger.info(
      {
        applied: applied.map((r) => `${r.migrationName}: ${r.status}`),
      },
      shouldRollBack ? 'rolled back to zero' : 'migrations up to date'
    )
  }

  await db.destroy()
}

main().catch(async (error: unknown) => {
  logger.error({ err: error }, 'migration runner crashed')
  process.exitCode = 1
  await db.destroy()
})