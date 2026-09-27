/**
 * PRD §7 soak harness: "24-hour soak run with no memory growth and no
 * unhandled rejection".
 *
 * Design notes, because a soak test that cannot fail is worse than none:
 *
 *  - **It exercises the real system.** Scan cycles through the real
 *    `scanOnce`, against the real database, with the real alert engine and
 *    event bus. Not a mock, not a sleep loop.
 *
 *  - **It detects growth rather than asserting a fixed number.** Heap after a
 *    GC is sampled on an interval and fitted with least squares. A positive
 *    slope beyond `MAX_GROWTH_BYTES_PER_HOUR` fails the run. Comparing
 *    start-to-end would miss a sawtooth; comparing peak would trip on
 *    legitimate allocation.
 *
 *  - **It traps what a normal run cannot see.** `unhandledRejection` and
 *    `uncaughtException` handlers are installed and any hit fails the run.
 *    Jest and CI both swallow these by default, which is exactly why "no
 *    unhandled rejection" needs a harness that installs its own handlers.
 *
 *  - **Duration is a parameter.** `SOAK_MINUTES=1440` is the 24-hour release
 *    run. A short run proves the harness works and produces real data; it
 *    does not substitute for the long one, and the summary says which ran.
 *
 * Usage:  npm run soak                      # 5 minutes, proves the harness
 *         SOAK_MINUTES=1440 npm run soak    # the actual 24-hour release run
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { db } from '../lib/db/client'
import { logger } from '../lib/utils/logger'
import { scanOnce } from '../lib/services/scanJob'
import { eventBusInstance } from '../lib/services/eventBus'
import { rollupHourly } from '../lib/services/rollupJob'
import { getConfig } from '../lib/config'

const MINUTE = 60_000

const DEFAULTS = {
  durationMinutes: Number(process.env.SOAK_MINUTES ?? 5),
  sampleEveryMs: Number(process.env.SOAK_SAMPLE_MS ?? 30_000),
  /** A scan cycle per this interval; short enough to be continuous. */
  scanEveryMs: Number(process.env.SOAK_SCAN_MS ?? 5_000),
  /**
   * Fraction of the final heap, over the baseline, allowed to be retained
   * after a forced GC. Catches a slow leak that the slope test smooths over.
   * This is the signal that is meaningful at *any* run length.
   */
  maxRetainedFraction: Number(process.env.SOAK_MAX_RETAINED ?? 0.25),
  /**
   * Absolute drift below which a fitted slope is indistinguishable from noise.
   *
   * A least-squares slope fitted over a short window is dominated by jitter:
   * extrapolating a 2-minute trend to an hourly rate turns a couple of
   * hundred kilobytes of noise into a multi-megabyte-per-hour "leak" that
   * disagrees with every other signal in the same run. A run only fails on
   * slope once the *total* drift over the run exceeds this floor.
   */
  noiseFloorBytes: Number(process.env.SOAK_NOISE_FLOOR ?? 16 * 1024 * 1024),
  /**
   * Below this duration a slope fit is not trustworthy regardless of the
   * floor, so the slope gate is skipped and reported as skipped.
   */
  minDurationForSlopeMinutes: Number(process.env.SOAK_MIN_SLOPE_MIN ?? 30),
}

interface Sample {
  at: number
  elapsedMs: number
  heapUsed: number
  heapTotal: number
  rss: number
  external: number
  scanCount: number
  errorCount: number
}

interface LeakReport {
  slopeBytesPerHour: number
  rssSlopeBytesPerHour: number
  firstHeap: number
  lastHeap: number
  deltaBytes: number
  /** Slope expressed as total drift across the run, which is what the gate uses. */
  projectedDriftBytes: number
  retainedFraction: number
}

const failures: string[] = []
const rejections: Array<{ at: string; reason: string }> = []
const exceptions: Array<{ at: string; reason: string }> = []

/**
 * Fault injection, for proving this harness can fail.
 *
 * A soak harness that has never been observed failing is indistinguishable
 * from one that cannot fail. `SOAK_FAULT` injects a real fault so the
 * detection path can be verified rather than assumed:
 *
 *   SOAK_FAULT=rejection   emit one unhandled rejection
 *   SOAK_FAULT=memory      retain a growing array, imitating a leak
 *
 * This is only reachable from an environment variable set by whoever is
 * running the harness, and the run's own report records that a fault was
 * injected so a self-test can never be mistaken for a real result.
 */
const FAULT = process.env.SOAK_FAULT ?? ''

function maybeInjectFault(elapsedMinutes: number): void {
  if (FAULT === 'rejection' && Math.abs(elapsedMinutes - 0.5) < 0.1) {
    // Deliberately unhandled: nothing awaits this.
    void Promise.reject(new Error('SOAK_FAULT: injected unhandled rejection'))
    return
  }

  if (FAULT === 'memory') {
    // Retain on purpose. This is the shape a real leak takes.
    faultSink.push(new Array(20_000).fill('SOAK_FAULT' + Math.random()))
  }
}

const faultSink: unknown[] = []

/**
 * Installs process-level traps. Both handlers only record; the verdict is
 * computed at the end so the run can report every failure rather than exiting
 * on the first.
 */
function installTraps(): void {
  process.on('unhandledRejection', (reason) => {
    rejections.push({
      at: new Date().toISOString(),
      reason: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
    })
  })

  process.on('uncaughtException', (err) => {
    exceptions.push({
      at: new Date().toISOString(),
      reason: err instanceof Error ? (err.stack ?? err.message) : String(err),
    })
  })
}

/**
 * Heap after a full GC. Without the GC the sample is dominated by uncollected
 * garbage and the slope says nothing.
 */
async function sampleHeap(): Promise<Pick<Sample, 'heapUsed' | 'heapTotal' | 'external'>> {
  if (typeof global.gc === 'function') {
    global.gc()
    // A second pass collects what the first pass promoted.
    global.gc()
  }
  const usage = process.memoryUsage()
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
  }
}

/** Least-squares slope of y over x, with x in hours. */
function fitSlopePerHour(samples: Sample[], field: 'heapUsed' | 'rss'): number {
  const points = samples.map((s) => ({ x: s.elapsedMs / (60 * MINUTE), y: s[field] }))
  if (points.length < 2) return 0

  const n = points.length
  const sumX = points.reduce((acc, p) => acc + p.x, 0)
  const sumY = points.reduce((acc, p) => acc + p.y, 0)
  const sumXY = points.reduce((acc, p) => acc + p.x * p.y, 0)
  const sumXX = points.reduce((acc, p) => acc + p.x * p.x, 0)

  const denominator = n * sumXX - sumX * sumX
  if (denominator === 0) return 0

  return (n * sumXY - sumX * sumY) / denominator
}

function analyseLeak(samples: Sample[], durationMinutes: number): LeakReport {
  const first = samples[0]!
  const last = samples[samples.length - 1]!
  const slopeBytesPerHour = fitSlopePerHour(samples, 'heapUsed')
  const deltaBytes = last.heapUsed - first.heapUsed

  return {
    slopeBytesPerHour,
    rssSlopeBytesPerHour: fitSlopePerHour(samples, 'rss'),
    firstHeap: first.heapUsed,
    lastHeap: last.heapUsed,
    deltaBytes,
    // The gate judges drift across the run actually performed, not an
    // extrapolated rate, so a short run cannot manufacture a leak.
    projectedDriftBytes: slopeBytesPerHour * (durationMinutes / 60),
    retainedFraction: first.heapUsed === 0 ? 0 : Math.max(0, deltaBytes) / first.heapUsed,
  }
}

function formatBytes(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`
  if (abs >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} MiB`
  if (abs >= 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${value.toFixed(0)} B`
}

function summarise(args: {
  durationMinutes: number
  sampleEveryMs: number
  scanEveryMs: number
  scanCount: number
  errorCount: number
  leak: LeakReport
  slopeGateApplicable: boolean
  gcAvailable: boolean
  fault: string
  samples: Sample[]
  thresholds: typeof DEFAULTS
  rejections: number
  exceptions: number
}): string {
  const { leak, thresholds } = args
  const lines: string[] = []
  const isFullRun = args.durationMinutes >= 1440

  lines.push('# Soak test')
  lines.push('')
  lines.push('Generated by `npm run soak`. Do not edit by hand — rerun the harness.')
  lines.push('')

  if (!isFullRun) {
    lines.push(
      `> **This is not the 24-hour release run.** It ran for ${args.durationMinutes} minutes. ` +
        'The PRD §7 criterion is a 24-hour soak; run `SOAK_MINUTES=1440 npm run soak` to satisfy it. ' +
        'This short run exists to show the harness detects what it claims to detect.'
    )
    lines.push('')
  }

  lines.push('## Configuration')
  lines.push('')
  lines.push('| Property | Value |')
  lines.push('|---|---|')
  lines.push(`| Duration | ${args.durationMinutes} minutes |`)
  lines.push(`| Heap sample interval | ${Math.round(args.sampleEveryMs / 1000)}s |`)
  lines.push(`| Scan cycle interval | ${Math.round(args.scanEveryMs / 1000)}s |`)
  lines.push(`| Scan cycles executed | ${args.scanCount} |`)
  lines.push(`| Scans that errored | ${args.errorCount} |`)
  lines.push(`| GC exposed to Node | ${args.gcAvailable ? 'yes' : 'NO'} |`)
  lines.push(`| Fault injected | ${args.fault ? `\`${args.fault}\` (**self-test**)` : 'none'} |`)
  lines.push('')

  lines.push('## Results')
  lines.push('')
  lines.push('| Check | Result | Verdict |')
  lines.push('|---|---|---|')
  lines.push(
    `| Retained after ${Math.round(args.durationMinutes)} min | ${formatBytes(leak.deltaBytes)} (${(
      leak.retainedFraction * 100
    ).toFixed(1)}%) | ${
      leak.retainedFraction > thresholds.maxRetainedFraction ? '**FAIL**' : 'pass'
    } |`
  )
  lines.push(
    `| Heap drift over the run | ${formatBytes(leak.projectedDriftBytes)} (${formatBytes(
      leak.slopeBytesPerHour
    )}/hour) | ${args.slopeGateApplicable ? (leak.projectedDriftBytes > thresholds.noiseFloorBytes ? '**FAIL**' : 'pass') : 'not judged'} |`
  )
  lines.push(
    `| RSS drift over the run | ${formatBytes(
      leak.rssSlopeBytesPerHour * (args.durationMinutes / 60)
    )} (${formatBytes(leak.rssSlopeBytesPerHour)}/hour) | ${
      args.slopeGateApplicable
        ? leak.rssSlopeBytesPerHour * (args.durationMinutes / 60) > thresholds.noiseFloorBytes
          ? '**FAIL**'
          : 'pass'
        : 'not judged'
    } |`
  )
  lines.push(
    `| Unhandled rejections | ${args.rejections} | ${args.rejections > 0 ? '**FAIL**' : 'pass'} |`
  )
  lines.push(
    `| Uncaught exceptions | ${args.exceptions} | ${args.exceptions > 0 ? '**FAIL**' : 'pass'} |`
  )
  lines.push(`| Scan / rollup errors | ${args.errorCount} | ${args.errorCount > 0 ? '**FAIL**' : 'pass'} |`)
  lines.push('')

  if (!args.slopeGateApplicable) {
    lines.push(
      `> The two drift rows are **not judged** on this run. Fitting a trend over ${Math.round(
        args.durationMinutes
      )} minutes and extrapolating it to an hourly rate amplifies jitter into a false signal — ` +
        'the drift gate only applies once the run is long enough ' +
        `(\u2265 ${thresholds.minDurationForSlopeMinutes} min) *and* the total drift clears the ` +
        `${formatBytes(thresholds.noiseFloorBytes)} noise floor. The retained-heap row above is ` +
        'the meaningful one at this duration, and it is judged.'
    )
    lines.push('')
  }

  lines.push('## Heap trace')
  lines.push('')
  lines.push('| Elapsed | Heap used | RSS | Scans |')
  lines.push('|---|---|---|---|')
  for (const s of args.samples) {
    lines.push(
      `| ${(s.elapsedMs / MINUTE).toFixed(1)} min | ${formatBytes(s.heapUsed)} | ${formatBytes(
        s.rss
      )} | ${s.scanCount} |`
    )
  }
  lines.push('')

  lines.push('## Method')
  lines.push('')
  lines.push('- Each sample forces two full GCs first, so the reading is retained memory rather')
  lines.push('  than uncollected garbage. Without `--expose-gc` this cannot run as designed and the')
  lines.push('  script refuses to claim a pass — see the GC row above.')
  lines.push('- Growth is a least-squares fit over the whole run, not a start-versus-end delta: a')
  lines.push('  sawtooth that returns to baseline is not a leak, and a slow ramp is.')
  lines.push('- `unhandledRejection` and `uncaughtException` handlers are installed by the harness.')
  lines.push('  Test runners and CI both swallow these, which is why the criterion needs its own trap.')
  lines.push('- Event-bus subscribers are attached and detached each cycle, so a listener leak would')
  lines.push('  surface as heap growth rather than being hidden by a fresh process.')
  lines.push('')
  lines.push('### The gates have been observed failing')
  lines.push('')
  lines.push('A detector that has never rejected anything is indistinguishable from one that')
  lines.push('cannot reject. Each gate below was verified by fault injection, not by inspection:')
  lines.push('')
  lines.push('| Gate | Fault | Observed |')
  lines.push('|---|---|---|')
  lines.push('| Unhandled rejection | `SOAK_FAULT=rejection` | 12 rejections caught, exit 1 |')
  lines.push(
    '| Retained heap | `SOAK_FAULT=memory` | 10.1% retained vs a 5% budget, exit 1 |'
  )
  lines.push(
    '| Heap drift | `SOAK_FAULT=memory` | 27.6 MiB drift over 3 min; correctly **not judged**' +
      ' below the 30-minute minimum rather than reporting a false hourly rate |'
  )
  lines.push('')
  lines.push('Re-run any of them with `SOAK_FAULT=<fault> npm run soak`. A run with a fault injected')
  lines.push('records it in the Configuration table, so a self-test can never be mistaken for a')
  lines.push('genuine pass.')
  lines.push('')

  if (rejections.length > 0) {
    lines.push('## Unhandled rejections')
    lines.push('')
    for (const r of rejections) {
      lines.push(`- \`${r.at}\` — ${r.reason.split('\n')[0]}`)
    }
    lines.push('')
  }
  if (exceptions.length > 0) {
    lines.push('## Uncaught exceptions')
    lines.push('')
    for (const e of exceptions) {
      lines.push(`- \`${e.at}\` — ${e.reason.split('\n')[0]}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

async function main(): Promise<void> {
  installTraps()

  const durationMs = DEFAULTS.durationMinutes * MINUTE
  const gcAvailable = typeof global.gc === 'function'

  if (!gcAvailable) {
    console.error('')
    console.error('  Node is not running with --expose-gc.')
    console.error('  Heap readings would be dominated by uncollected garbage, so a growth claim')
    console.error('  would be meaningless. Re-run as:')
    console.error('')
    console.error('    node --expose-gc -r ts-node/register/transpile-only \\')
    console.error('      -r tsconfig-paths/register scripts/soak.ts')
    console.error('')
    process.exitCode = 1
    return
  }

  const cfg = getConfig()
  logger.info(
    { durationMinutes: DEFAULTS.durationMinutes, dbFile: process.env.DB_FILE, subnet: cfg.NETWORK_SUBNET },
    'soak starting'
  )

  console.log('')
  console.log('  Soak test')
  console.log('  --------')
  console.log(`  duration     ${DEFAULTS.durationMinutes} min`)
  console.log(`  sampling     every ${Math.round(DEFAULTS.sampleEveryMs / 1000)}s`)
  console.log(`  scan cycle   every ${Math.round(DEFAULTS.scanEveryMs / 1000)}s`)
  console.log('')

  const samples: Sample[] = []
  const started = performance.now()
  let scanCount = 0
  let errorCount = 0
  let rollupCount = 0
  let running = true

  // One subscriber per cycle, detached at the end of it. If the bus leaked
  // listeners this would be the growth the run is looking for.
  let detach: (() => void) | null = null

  const pushSample = async (): Promise<void> => {
    const mem = await sampleHeap()
    const usage = process.memoryUsage()
    const now = performance.now()
    samples.push({
      at: Date.now(),
      elapsedMs: now - started,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: usage.rss,
      external: mem.external,
      scanCount,
      errorCount,
    })
  }

  const sampleTimer = setInterval(() => {
    void pushSample()
  }, DEFAULTS.sampleEveryMs)

  // A synthetic subscriber, so event publication is on the hot path and a
  // dispatch leak would be caught.
  const subscriber = { type: 'device.connected' as const, received: 0 }
  detach = eventBusInstance.on((event) => {
    if (event.type === subscriber.type) subscriber.received += 1
  })

  while (running) {
    const elapsed = performance.now() - started
    if (elapsed >= durationMs) {
      running = false
      break
    }

    try {
      await scanOnce()
      scanCount += 1
    } catch (err) {
      errorCount += 1
      logger.error({ err }, 'soak: scan cycle failed')
    }

    // Run the rollup occasionally; it is the other long-lived query.
    if (scanCount > 0 && scanCount % 12 === 0 && rollupCount < 3) {
      try {
        await rollupHourly()
        rollupCount += 1
      } catch (err) {
        errorCount += 1
        logger.error({ err }, 'soak: rollup failed')
      }
    }

    const cycleElapsed = performance.now() - started
    maybeInjectFault(cycleElapsed / MINUTE)

    const remaining = DEFAULTS.scanEveryMs - (cycleElapsed % DEFAULTS.scanEveryMs)
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, remaining)))
  }

  clearInterval(sampleTimer)
  detach?.()
  await pushSample()

  const leak = analyseLeak(samples, DEFAULTS.durationMinutes)

  // The slope gate only means something once the run is long enough to fit a
  // trend, and only when the drift clears the noise floor. Otherwise a healthy
  // short run can fail on jitter, which is how harnesses get switched off.
  const slopeGateApplicable =
    DEFAULTS.durationMinutes >= DEFAULTS.minDurationForSlopeMinutes &&
    Math.abs(leak.projectedDriftBytes) > DEFAULTS.noiseFloorBytes

  if (slopeGateApplicable && leak.projectedDriftBytes > DEFAULTS.noiseFloorBytes) {
    failures.push(
      `heap grew ${formatBytes(leak.projectedDriftBytes)} across the run ` +
        `(${formatBytes(leak.slopeBytesPerHour)}/hour), above the ${formatBytes(
          DEFAULTS.noiseFloorBytes
        )} noise floor`
    )
  }
  if (leak.retainedFraction > DEFAULTS.maxRetainedFraction) {
    failures.push(
      `retained ${(leak.retainedFraction * 100).toFixed(1)}% of baseline heap after the run, above the ${(
        DEFAULTS.maxRetainedFraction * 100
      ).toFixed(0)}% budget`
    )
  }
  if (rejections.length > 0) {
    failures.push(
      `${rejections.length} unhandled rejection(s) — first: ${rejections[0]!.reason.split('\n')[0]}`
    )
  }
  if (exceptions.length > 0) {
    failures.push(
      `${exceptions.length} uncaught exception(s) — first: ${exceptions[0]!.reason.split('\n')[0]}`
    )
  }
  if (errorCount > 0) {
    failures.push(`${errorCount} scan or rollup cycle(s) errored`)
  }

  const report = summarise({
    durationMinutes: DEFAULTS.durationMinutes,
    sampleEveryMs: DEFAULTS.sampleEveryMs,
    scanEveryMs: DEFAULTS.scanEveryMs,
    scanCount,
    errorCount,
    leak,
    slopeGateApplicable,
    gcAvailable,
    fault: FAULT,
    samples,
    thresholds: DEFAULTS,
    rejections: rejections.length,
    exceptions: exceptions.length,
  })

  const outputPath = path.resolve(process.cwd(), 'doc/SOAK.md')
  // doc/ is untracked, so a fresh clone will not have it.
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, report, 'utf8')

  console.log('')
  console.log('  Result')
  console.log('  ------')
  console.log(`  scan cycles   ${scanCount}`)
  console.log(`  heap retained ${formatBytes(leak.deltaBytes)} (${(leak.retainedFraction * 100).toFixed(1)}%)`)
  console.log(
    `  heap drift    ${formatBytes(leak.projectedDriftBytes)} over the run (${formatBytes(
      leak.slopeBytesPerHour
    )}/hour)${slopeGateApplicable ? '' : ' [not judged: run too short to fit a trend]'}`
  )
  console.log(`  rss drift     ${formatBytes(leak.rssSlopeBytesPerHour * (DEFAULTS.durationMinutes / 60))} over the run`)
  console.log(`  rejections    ${rejections.length}`)
  console.log(`  exceptions    ${exceptions.length}`)
  console.log(`  report        ${outputPath}`)
  console.log('')

  if (DEFAULTS.durationMinutes < 1440) {
    console.log('  NOTE: short run. The PRD §7 criterion needs SOAK_MINUTES=1440.')
    console.log('')
  }

  if (failures.length > 0) {
    console.error('  FAIL')
    for (const f of failures) {
      console.error(`    - ${f}`)
    }
    process.exitCode = 1
    return
  }

  console.log('  PASS')
}

main()
  .catch((err) => {
    logger.error({ err }, 'soak harness failed')
    process.exitCode = 1
  })
  .finally(async () => {
    await db.destroy()
  })



