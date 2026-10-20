import * as bandwidthRepo from '@/lib/db/repositories/bandwidthRepository'
import * as deviceRepo from '@/lib/db/repositories/deviceRepository'
import { getEffectiveScanSettings } from '@/lib/services/runtimeSettings'
import { logger } from '@/lib/utils/logger'
import type { TrafficCounters } from '@/lib/services/scanners/types'

/**
 * The producer for `bandwidth_metrics`.
 *
 * Every read path for bandwidth was already wired end to end — latest sample
 * per device, network totals, today's peak, top consumers, the 5s overview
 * refetch — but nothing in production ever called
 * `insertBandwidthMetric`. Only tests and seed scripts did. The consequence was
 * that F-20 (live throughput), F-21 (cumulative totals), F-22 (history),
 * F-23 (daily peak) and F-24 (top consumers) all rendered zero or null on a
 * real deployment, while looking perfectly implemented.
 *
 * How a rate is derived: routers report **cumulative** byte counters. A rate
 * needs two samples, so this module keeps the previous reading per MAC in
 * memory and differences it against the current one, dividing by the actual
 * elapsed time rather than the nominal scan interval — a scan that overran must
 * not be reported as a spike.
 *
 * Counter resets (router reboot, counter wrap) produce a negative delta. That
 * is treated as "unknown", not as a huge negative rate, and the sample is
 * skipped; the stored running total still advances from the last known value so
 * F-21 stays monotonic.
 */

interface PreviousSample {
  uploadBytes: number
  downloadBytes: number
  at: number
}

/** Per-MAC last reading, keyed by normalised MAC. Process-local by design. */
const lastReading = new Map<string, PreviousSample>()

const BYTES_PER_MB = 1_000_000

/**
 * Minimum elapsed time used for a rate calculation, in seconds.
 *
 * A scan can return almost instantly — the simulated scanner has no I/O at all,
 * and a cached router response is milliseconds. Dividing a real byte delta by
 * 0.02s reports a spike in the thousands of Mbps that no link could carry, and
 * that number then drives the bandwidth-threshold alert. Two seconds is below
 * any legitimate scan interval (the floor is 30s) while being large enough that
 * scheduler jitter cannot manufacture a phantom spike.
 */
const MIN_ELAPSED_SECONDS = 2

/**
 * Injectable clock. The rate depends on *elapsed* time, and a test that calls
 * the sampler twice in the same millisecond would measure a divide-by-near-zero
 * rather than the conversion itself. Production never overrides this.
 */
let now = (): number => Date.now()

/** Exposed for tests only: pin the clock so elapsed time is deterministic. */
export function __setBandwidthClock(clock: (() => number) | null): void {
  now = clock ?? (() => Date.now())
}

function toMbps(bytes: number, elapsedSeconds: number): number {
  const seconds = Math.max(elapsedSeconds, MIN_ELAPSED_SECONDS)
  const mbps = (bytes * 8) / BYTES_PER_MB / seconds
  // Sub-kbps jitter on a counter that barely moved is noise, not traffic.
  return Number.isFinite(mbps) && mbps > 0 ? Number(mbps.toFixed(3)) : 0
}

/** Exposed for tests: a fresh process has no history, so tests must reset. */
export function resetBandwidthSampler(): void {
  lastReading.clear()
}

export interface BandwidthSample {
  deviceId: string
  macAddress: string
  uploadMbps: number
  downloadMbps: number
}

/**
 * Records one bandwidth sample for every device whose scanner reported
 * cumulative counters.
 *
 * The first observation of a device establishes a *baseline* and writes nothing:
 * a rate computed from one reading would divide a device's lifetime traffic by
 * a single scan interval and report an enormous phantom spike. From the second
 * observation onward there is a genuine delta.
 *
 * Errors are per device and never propagate: a bandwidth sample is telemetry,
 * and a failure to record one must not abort the scan cycle that produced it.
 */
export async function recordBandwidthSamples(
  discovered: Array<{ macAddress: string; traffic?: TrafficCounters }>
): Promise<BandwidthSample[]> {
  const withTraffic = discovered.filter((d) => d.traffic != null)
  if (withTraffic.length === 0) return []

  const timestamp = now()
  let scanIntervalSeconds: number
  try {
    scanIntervalSeconds = (await getEffectiveScanSettings()).scanIntervalSeconds
  } catch {
    scanIntervalSeconds = 30
  }

  const samples: BandwidthSample[] = []

  for (const entry of withTraffic) {
    const traffic = entry.traffic
    if (!traffic) continue

    const mac = entry.macAddress.toUpperCase()
    const previous = lastReading.get(mac)
    lastReading.set(mac, {
      uploadBytes: traffic.uploadBytes,
      downloadBytes: traffic.downloadBytes,
      at: timestamp,
    })

    if (!previous) continue

    const elapsedSeconds = (timestamp - previous.at) / 1000
    const uploadDelta = traffic.uploadBytes - previous.uploadBytes
    const downloadDelta = traffic.downloadBytes - previous.downloadBytes

    if (uploadDelta < 0 || downloadDelta < 0) {
      // Counter reset — the router restarted. Re-baselined above; skip the rate.
      logger.debug({ mac }, 'traffic counters reset, skipping bandwidth sample')
      continue
    }

    const device = await deviceRepo.findByMac(mac).catch(() => null)
    if (!device) continue

    const uploadMbps = toMbps(uploadDelta, elapsedSeconds)
    const downloadMbps = toMbps(downloadDelta, elapsedSeconds)

    // Running totals: the previous stored total plus what moved since. The
    // first time a device is seen the previous total is absent, so the router's
    // own cumulative counter seeds it.
    const prior = await bandwidthRepo.findLatestForDevice(device.id).catch(() => null)
    const priorUploadTotal = prior ? Number(prior.uploadTotal) : 0
    const priorDownloadTotal = prior ? Number(prior.downloadTotal) : 0

    const uploadTotal =
      priorUploadTotal > 0 ? priorUploadTotal + uploadDelta : traffic.uploadBytes
    const downloadTotal =
      priorDownloadTotal > 0 ? priorDownloadTotal + downloadDelta : traffic.downloadBytes

    try {
      await bandwidthRepo.insertBandwidthMetric({
        deviceId: device.id,
        timestamp: new Date(timestamp),
        uploadSpeed: uploadMbps,
        downloadSpeed: downloadMbps,
        uploadTotal: String(uploadTotal),
        downloadTotal: String(downloadTotal),
      })

      samples.push({
        deviceId: device.id,
        macAddress: mac,
        uploadMbps,
        downloadMbps,
      })
    } catch (err) {
      logger.error({ err, mac }, 'failed to record bandwidth sample')
    }
  }

  if (samples.length === 0 && withTraffic.length > 0) {
    // First pass after boot: baselines only. Logged so an operator does not
    // read "no bandwidth rows" as a broken feature.
    logger.info(
      { devices: withTraffic.length, intervalSeconds: scanIntervalSeconds },
      'bandwidth sampler established baselines (no rates yet)'
    )
  }

  return samples
}
