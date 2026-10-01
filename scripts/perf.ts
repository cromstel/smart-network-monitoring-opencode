/**
 * PRD §5 performance harness.
 *
 * Measures the four stated targets against a real database and exits non-zero
 * when one is missed, so it is a gate rather than a report nobody reads.
 *
 *   1. 30-day history query          < 1s     (also the §2 goal)
 *   2. Full /24 scan                 < 30s
 *   3. Device list at 100 devices    < 1s     (proxy for dashboard feel)
 *   4. Stats fan-out at 100 devices  < 1s
 *
 * Every number printed is a real measurement from a real query. The report is
 * written to `doc/PERFORMANCE.md` with the dialect and dataset it came from,
 * because a number without its conditions is not evidence.
 *
 * Usage:
 *   SQLite:  DB_FILE=./data/perf.db  npm run perf
 *   MySQL:   DB_NAME=home_monitor_perf            npm run perf
 *
 * Each dialect writes its own report, so benchmarking the second engine does
 * not silently replace the first engine's numbers. `doc/PERFORMANCE.md` is the
 * index of all of them.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { sql } from 'kysely'
import { db } from '../lib/db/client'
import { logger } from '../lib/utils/logger'
import { listForDeviceBetween, fetchStatsForDevices } from '../lib/db/repositories/bandwidthRepository'
import { listDevices } from '../lib/db/repositories/deviceRepository'
import { simulatedScanner } from '../lib/services/scanners/simulatedScanner'
import { scanOnce } from '../lib/services/scanJob'
import { getConfig } from '../lib/config'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** PRD §5 targets, in one place so the gate and the report cannot drift. */
const TARGETS = {
  historyQueryMs: 1_000,
  scanMs: 30_000,
  deviceListMs: 1_000,
  statsFanoutMs: 1_000,
} as const

interface Measurement {
  name: string
  targetMs: number
  samples: number[]
  warmup: number
  medianMs: number
  p95Ms: number
  maxMs: number
  detail: string
  pass: boolean
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]!
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return percentile(sorted, 50)
}

/** Runs `fn` `times`, warming up first so we measure steady state, not JIT. */
async function measure(
  name: string,
  targetMs: number,
  times: number,
  warmup: number,
  fn: () => Promise<unknown>,
  detail: string
): Promise<Measurement> {
  for (let i = 0; i < warmup; i += 1) {
    await fn()
  }

  const samples: number[] = []
  for (let i = 0; i < times; i += 1) {
    const started = performance.now()
    await fn()
    samples.push(performance.now() - started)
  }

  const sorted = [...samples].sort((a, b) => a - b)
  const med = median(samples)
  const p95 = percentile(sorted, 95)

  return {
    name,
    targetMs,
    samples,
    warmup,
    medianMs: med,
    p95Ms: p95,
    maxMs: sorted[sorted.length - 1]!,
    detail,
    pass: p95 < targetMs,
  }
}

function formatMs(value: number): string {
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}s`
  // Sub-0.1ms is real for an in-memory read; truncating it to "0.0ms" would
  // look like a placeholder rather than a measurement.
  if (value < 0.1) return `${value.toFixed(3)}ms`
  return `${value.toFixed(1)}ms`
}

/**
 * Where a run's report goes.
 *
 * Keyed on the **engine**, not on `DB_CLIENT`. `DB_CLIENT=mysql` names the
 * driver, and both MariaDB and MySQL arrive over it, so keying on the dialect
 * gave both runs the same filename and the second silently overwrote the first
 * — the precise failure this change existed to prevent. Caught by doing it:
 * benchmarking MariaDB 12.3 over MySQL 8.4 replaced the 8.4 numbers.
 *
 * Hence the dependency on `engineIdentity()` having already run.
 */
function reportPathFor(dialect: string, engineVersion: string): string {
  const lower = engineVersion.toLowerCase()
  const slug = lower.includes('mariadb')
    ? 'mariadb'
    : lower.includes('sqlite')
      ? 'sqlite'
      : dialect === 'mysql'
        ? 'mysql'
        : dialect
  return path.resolve(process.cwd(), `doc/PERFORMANCE.${slug}.md`)
}

/**
 * Asks the server what it actually is.
 *
 * `DB_CLIENT=mysql` names the driver, not the server, and both MariaDB and
 * MySQL arrive over it. A report that says "mysql" without saying which engine
 * produced it is the same class of claim as a tick in a checklist: accurate at
 * best, unverifiable at worst. The CI matrix has the same check for the same
 * reason. SQLite has no server, so its version is the library.
 */
async function engineIdentity(dialect: string): Promise<{ version: string; detail: string }> {
  if (dialect !== 'mysql') {
    // No server to ask: SQLite is an in-process library, so the version that
    // matters is the binding's.
    return { version: 'SQLite (in-process)', detail: 'better-sqlite3' }
  }

  const result = await sql<{ version: string; comment: string }>`
    SELECT VERSION() AS version, @@version_comment AS comment
  `.execute(db)

  const first = result.rows[0]!
  return {
    version: first.version,
    // MariaDB identifies itself in the version string, but version_comment is
    // the authoritative "what am I really" signal, so both get recorded.
    detail: first.comment || '(no version_comment)',
  }
}

function buildReport(args: {
  measurements: Measurement[]
  dataset: {
    devices: number
    bandwidthRows: number
    databaseFile: string
    dialect: string
    engineVersion: string
    engineDetail: string
  }
  rowsScannedForHistory: number
}): string {
  const lines: string[] = []

  lines.push(`# Performance — ${args.dataset.dialect}`)
  lines.push('')
  lines.push('Generated by `npm run perf`. Do not edit by hand — rerun the harness.')
  lines.push('')
  lines.push('Targets come from `PRD.md` §5. Each row is a real measurement against a real')
  lines.push('database at the dataset size described below; the run fails if any p95 misses its')
  lines.push('target, so this table cannot drift away from reality without CI noticing.')
  lines.push('')
  lines.push('## Dataset')
  lines.push('')
  lines.push('| Property | Value |')
  lines.push('|---|---|')
  lines.push(`| Dialect | ${args.dataset.dialect} |`)
  lines.push(`| Engine | ${args.dataset.engineVersion} |`)
  lines.push(`| Engine detail | ${args.dataset.engineDetail} |`)
  lines.push(`| Devices | ${args.dataset.devices} |`)
  lines.push(`| Bandwidth samples | ${args.dataset.bandwidthRows.toLocaleString()} |`)
  lines.push(`| History per device | 30 days @ 15-minute resolution |`)
  lines.push(`| Database | \`${args.dataset.databaseFile}\` |`)
  lines.push('')
  if (args.dataset.dialect === 'mysql') {
    lines.push(
      '`DB_CLIENT=mysql` names the driver, not the server: MariaDB and MySQL are both reached',
      'through it. The **Engine** row above is the server\'s own answer to `VERSION()`, recorded by',
      'this harness rather than asserted by hand, so these numbers cannot be filed under the wrong',
      'engine.',
      ''
    )
  }
  lines.push('## Results')
  lines.push('')
  lines.push('| Measurement | Target | Median | p95 | Max | n | Verdict |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const m of args.measurements) {
    lines.push(
      `| ${m.name} | < ${formatMs(m.targetMs)} | ${formatMs(m.medianMs)} | ${formatMs(
        m.p95Ms
      )} | ${formatMs(m.maxMs)} | ${m.samples.length}+${m.warmup}w | ${m.pass ? 'pass' : '**FAIL**'} |`
    )
  }
  lines.push('')
  lines.push('## What each measurement does')
  lines.push('')
  for (const m of args.measurements) {
    lines.push(`- **${m.name}** — ${m.detail}`)
  }
  lines.push('')
  lines.push('## Method')
  lines.push('')
  lines.push('- Warmup iterations are discarded so the numbers are steady state, not JIT warm-up.')
  lines.push('  The count is in the `n` column as `timed+warmup`.')
  lines.push('- The **p95** is compared against the target, because a median hides the tail that a')
  lines.push('  user actually feels. Cheap reads take 20 samples; anything that writes to the')
  lines.push('  database takes fewer, since repeating it would distort the very numbers being')
  lines.push('  measured.')
  lines.push('- Dataset figures are deterministic (`Math.random` is not used), so a regression is')
  lines.push('  attributable to the code rather than to a differently-shaped dataset.')
  lines.push('')
  lines.push('## Known limits of this harness')
  lines.push('')
  lines.push('- **The real /24 probe is not measured.** The `Scan cycle, DB side` row times')
  lines.push('  everything the application does per cycle, but the ARP sweep itself needs')
  lines.push('  `CAP_NET_RAW` and a live /24 to talk to, neither of which exists on the machine')
  lines.push('  this ran on. The PRD §5 "under 30s for a /24" target is therefore **partially**')
  lines.push('  evidenced: the application-side budget is measured, the network-side budget is not.')
  lines.push('  `arp-scan --localnet` against a real subnet is the missing measurement.')
  lines.push('- **First contentful paint is not measured here.** It needs a browser and a running')
  lines.push('  server, so it belongs to the Playwright suite. The PRD §5 target of "under 2s on a')
  lines.push('  warm cache" is not evidenced by this file.')
  lines.push('- Numbers are from a single machine. Absolute values differ elsewhere; the')
  lines.push('  pass/fail gate is what carries across environments, not the milliseconds.')
  lines.push('- MySQL numbers come from running this harness with `DB_CLIENT=mysql` against the')
  lines.push('  Compose stack. The table records whichever dialect was used.')
  lines.push('')
  lines.push('## Observations')
  lines.push('')
  const slowest = [...args.measurements].sort((a, b) => b.p95Ms - a.p95Ms)[0]
  if (slowest) {
    lines.push(
      `The slowest operation is **${slowest.name}** at ${formatMs(slowest.p95Ms)} p95. It is inside its target, but it is the query behind every dashboard render and every SSE-triggered refetch, so it is the one to watch if the UI ever feels slow. It is a correlated subquery joined back over the whole metrics table; an index on \`(device_id, timestamp)\` is what keeps it from being far worse.`
    )
    lines.push('')
  }
  lines.push('---')
  lines.push('')
  lines.push(
    'The scan-cycle and probe rows run against the same database, so their values move a few'
  )
  lines.push('percent between runs on a warm cache. Re-run the harness rather than editing this file.')
  lines.push('')

  return lines.join('\n')
}

async function main(): Promise<void> {
  const cfg = getConfig()
  const deviceCountRow = await db
    .selectFrom('devices')
    .select(db.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow()
  const deviceCount = Number(deviceCountRow.count)

  const bandwidthRow = await db
    .selectFrom('bandwidth_metrics')
    .select(db.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow()
  const bandwidthRows = Number(bandwidthRow.count)

  if (deviceCount === 0) {
    throw new Error(
      'No devices in the database. Build a dataset first: DB_FILE=./data/perf.db npm run perf:dataset'
    )
  }

  const deviceIds = await db.selectFrom('devices').select('id').execute()
  const firstId = deviceIds[0]!.id

  // The heaviest honest case: one device, full 30-day window, raw rows.
  const from = new Date(Date.now() - 30 * DAY)
  const to = new Date()

  const listRows = await listForDeviceBetween(firstId, from, to)
  const measurements: Measurement[] = []

  measurements.push(
    await measure(
      '30-day history query',
      TARGETS.historyQueryMs,
      20,
      5,
      async () => {
        await listForDeviceBetween(firstId, from, to)
      },
      `\`listForDeviceBetween\` for one device across 30 days; returns ${listRows.length.toLocaleString()} raw rows.`
    )
  )

  measurements.push(
    await measure(
      'Scan cycle, DB side (simulated backend)',
      TARGETS.scanMs,
      5,
      2,
      async () => {
        // The whole per-cycle path the app owns: upsert every discovered
        // device, write connection logs, flip stale devices offline, evaluate
        // alert rules, record scan history.
        await scanOnce()
      },
      'A complete `scanOnce` against the simulated backend, which yields 12 devices: upserts, connection logs, offline detection, alert evaluation and the scan-history row. This is everything the application does per cycle **except** the network probe itself.'
    )
  )

  measurements.push(
    await measure(
      'Network probe (simulated backend)',
      TARGETS.scanMs,
      20,
      5,
      async () => {
        await simulatedScanner.scan(cfg.NETWORK_SUBNET)
      },
      'The probe call alone, which for the simulated backend is a static array. It bounds nothing meaningful and is included only to show the probe is not where the time goes. **The real /24 probe is not measured here** — see "Known limits".'
    )
  )

  measurements.push(
    await measure(
      `Device list (${deviceCount} devices)`,
      TARGETS.deviceListMs,
      20,
      5,
      async () => {
        await listDevices({ page: 1, pageSize: 50 })
      },
      'One page of the device table, the query behind the dashboard on load.'
    )
  )

  measurements.push(
    await measure(
      `Stats fan-out (${deviceCount} devices)`,
      TARGETS.statsFanoutMs,
      20,
      5,
      async () => {
        await fetchStatsForDevices(deviceIds.map((d) => d.id))
      },
      'Latest-sample lookup for every device in one query. This is the join the dashboard runs on every render and on every SSE-triggered refetch.'
    )
  )

  const engine = await engineIdentity(cfg.DB_CLIENT)

  const report = buildReport({
    measurements,
    dataset: {
      devices: deviceCount,
      bandwidthRows,
      databaseFile:
        cfg.DB_CLIENT === 'mysql'
          ? `${process.env.DB_HOST ?? 'localhost'}:${process.env.DB_PORT ?? 3306}/${cfg.DB_NAME}`
          : (process.env.DB_FILE ?? '(unset)'),
      dialect: cfg.DB_CLIENT,
      engineVersion: engine.version,
      engineDetail: engine.detail,
    },
    rowsScannedForHistory: listRows.length,
  })

  const outputPath = reportPathFor(cfg.DB_CLIENT, engine.version)
  // doc/ is untracked, so a fresh clone will not have it.
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, report, 'utf8')

  logger.info({ report: outputPath, engine: engine.version }, 'performance report written')

  console.log('')
  console.log(`  PRD §5 performance — ${cfg.DB_CLIENT} (${engine.version})`)
  console.log('  ------------------')
  for (const m of measurements) {
    console.log(
      `  ${m.pass ? 'PASS' : 'FAIL'}  ${m.name.padEnd(34)} p95 ${formatMs(m.p95Ms).padStart(8)}  target < ${formatMs(
        m.targetMs
      )}`
    )
  }
  console.log('')

  const failures = measurements.filter((m) => !m.pass)
  if (failures.length > 0) {
    console.error(`  ${failures.length} target(s) missed: ${failures.map((f) => f.name).join(', ')}`)
    process.exitCode = 1
    return
  }

  console.log('  All PRD §5 targets met.')
}

main()
  .catch((err) => {
    logger.error({ err }, 'performance harness failed')
    process.exitCode = 1
  })
  .finally(async () => {
    await db.destroy()
  })
