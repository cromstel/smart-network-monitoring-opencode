import { randomUUID } from 'node:crypto'
import { selectScanner } from './scanners/selector'
import { upsertFromScan, findByMac, findAllMacAddresses } from '@/lib/db/repositories/deviceRepository'
import { insert as insertConnectionLog } from '@/lib/db/repositories/connectionLogRepository'
import { db } from '@/lib/db/client'
import { logger } from '@/lib/utils/logger'
import { eventBusInstance } from '@/lib/services/eventBus'
import { markStaleDevicesOffline, getDeviceById } from '@/lib/services/deviceService'
import {
  evaluateUnknownDevice,
  evaluateDeviceOffline,
  evaluateBandwidthThreshold,
} from '@/lib/services/alertService'
import { recordBandwidthSamples } from '@/lib/services/bandwidthService'
import { resolveHostnamesForDevices } from '@/lib/services/reverseDns'
import { getEffectiveScanSettings } from '@/lib/services/runtimeSettings'
import { lookupVendor, normalizeMac } from './oui'
import type { Device } from '@/lib/types'
import type { DiscoveredDevice } from './scanners/types'

export interface ScanResult {
  scanner: string
  durationMs: number
  devicesFound: number
  newDevices: number
  reconnected: number
  wentOffline: number
  errors: number
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * One scan cycle.
 *
 * Ordering matters and is deliberate:
 *   1. ingest every discovered device (idempotent upsert),
 *   2. raise "unknown device" alerts *only* for rows that did not exist,
 *   3. write the connection log + SSE event for genuinely new arrivals,
 *   4. flip stale devices offline, then raise their alerts.
 *
 * Steps 2 and 3 key off "was this row already there?", which is what stops a
 * device that is simply re-seen every 30s from raising an alert each cycle
 * (TODO B-50: one connection, exactly one alert).
 */
export async function scanOnce(): Promise<ScanResult> {
  const start = Date.now()
  const scanner = await selectScanner()

  // The subnet and interval come from the *effective* settings, not straight
  // from the environment: a saved settings row overrides it, which is what
  // makes the settings page real rather than write-only.
  const effective = await getEffectiveScanSettings()

  logger.info(
    { scanner: scanner.name, subnet: effective.subnet, source: effective.source },
    'starting network scan'
  )

  const knownMacs = new Set(await findAllMacAddresses())
  const discovered = await scanner.scan(effective.subnet)

  await applyReverseDns(discovered)

  let newDevices = 0
  let reconnected = 0
  let errors = 0

  for (const d of discovered) {
    try {
      await ingest(d, knownMacs, {
        onNew: () => {
          newDevices += 1
        },
        onReconnect: () => {
          reconnected += 1
        },
      })
    } catch (err) {
      errors += 1
      logger.error({ err, mac: d.macAddress }, 'failed to ingest discovered device')
    }
  }

  // Bandwidth sampling runs after ingest so every MAC already has a device row
  // to attribute the sample to. It is intentionally non-fatal: telemetry must
  // never take down the scan that produced it.
  let bandwidthSamples = 0
  try {
    const samples = await recordBandwidthSamples(discovered)
    bandwidthSamples = samples.length
  } catch (err) {
    errors += 1
    logger.error({ err }, 'bandwidth sampling failed')
  }

  const wentOffline = await markStaleDevicesOffline(effective.scanIntervalSeconds)
  if (wentOffline.length > 0) {
    try {
      await evaluateDeviceOffline(wentOffline)
    } catch (err) {
      errors += 1
      logger.error({ err }, 'failed to evaluate offline alerts')
    }
  }

  // F-31: the threshold check needs current throughput, which only exists once
  // this cycle's samples are stored. This is the call site that was missing —
  // `evaluateBandwidthThreshold` was defined and never invoked, so a configured
  // bandwidth rule could never fire.
  if (bandwidthSamples > 0) {
    try {
      await evaluateBandwidthAlerts(discovered)
    } catch (err) {
      errors += 1
      logger.error({ err }, 'failed to evaluate bandwidth alerts')
    }
  }

  const durationMs = Date.now() - start

  await recordScanHistory({
    scannerName: scanner.name,
    durationMs,
    deviceCount: discovered.length,
    successCount: newDevices,
    failureCount: errors,
    status: errors > 0 ? 'partial' : 'success',
    errorMessage: errors > 0 ? `${errors} device(s) failed to ingest` : null,
  })

  logger.info(
    {
      scanner: scanner.name,
      durationMs,
      devicesFound: discovered.length,
      newDevices,
      reconnected,
      wentOffline: wentOffline.length,
      errors,
    },
    'scan completed'
  )

  return {
    scanner: scanner.name,
    durationMs,
    devicesFound: discovered.length,
    newDevices,
    reconnected,
    wentOffline: wentOffline.length,
    errors,
  }
}

interface IngestCounters {
  onNew: () => void
  onReconnect: () => void
}

/**
 * F-03: fills in hostnames the scanner could not provide.
 *
 * Mutates in place because the discovery array is this cycle's working set and
 * a copy would have to be re-joined by MAC for no benefit. A device that
 * already has a hostname is left exactly as the scanner reported it.
 */
async function applyReverseDns(discovered: DiscoveredDevice[]): Promise<void> {
  try {
    const resolved = await resolveHostnamesForDevices(discovered)
    if (resolved.size === 0) return

    for (const device of discovered) {
      if (device.hostname) continue
      const hostname = resolved.get(normalizeMac(device.macAddress))
      if (hostname) device.hostname = hostname
    }
  } catch (err) {
    // Name resolution is a nicety; a dead resolver must not fail a scan.
    logger.error({ err }, 'reverse-DNS resolution failed')
  }
}

/**
 * F-31: re-reads each device with its freshly stored bandwidth sample and runs
 * the threshold rule against it.
 *
 * Reads back through `getDeviceById` rather than trusting the in-memory sample,
 * so the value the alert sees is the same value the dashboard will render on
 * its next 5s poll. An alert that disagrees with the number on screen is worse
 * than no alert.
 */
async function evaluateBandwidthAlerts(discovered: DiscoveredDevice[]): Promise<void> {
  for (const entry of discovered) {
    if (!entry.traffic) continue

    const device = await findByMac(normalizeMac(entry.macAddress))
    if (!device || device.status !== 'online') continue

    const enriched = await getDeviceById(device.id)
    if (!enriched) continue

    await evaluateBandwidthThreshold(enriched)
  }
}

async function ingest(
  d: DiscoveredDevice,
  knownMacs: Set<string>,
  counters: IngestCounters
): Promise<void> {
  const mac = normalizeMac(d.macAddress)
  const existing = await findByMac(mac)
  const vendor = lookupVendor(mac) ?? d.manufacturer ?? null

  await upsertFromScan({
    macAddress: mac,
    ipAddress: d.ipAddress,
    hostname: d.hostname ?? null,
    manufacturer: vendor,
    signalStrength: d.signalStrength ?? null,
  })

  const device = await findByMac(mac)
  if (!device) {
    throw new Error(`device ${mac} vanished immediately after upsert`)
  }

  if (!existing) {
    // Genuinely new to the network.
    knownMacs.add(mac)
    counters.onNew()

    await insertConnectionLog({
      deviceId: device.id,
      eventType: 'connected',
      timestamp: new Date(),
      ipAddress: d.ipAddress,
      connectionDuration: null,
    })

    eventBusInstance.emit({
      type: 'device.connected',
      timestamp: nowIso(),
      payload: {
        deviceId: device.id,
        macAddress: mac,
        ipAddress: d.ipAddress,
        hostname: d.hostname ?? undefined,
      },
    })

    try {
      await evaluateUnknownDevice(device)
    } catch (err) {
      logger.error({ err, deviceId: device.id }, 'failed to evaluate unknown-device alert')
    }
    return
  }

  if (existing.status === 'offline') {
    // It was marked offline and is answering again.
    counters.onReconnect()

    await insertConnectionLog({
      deviceId: device.id,
      eventType: 'connected',
      timestamp: new Date(),
      ipAddress: d.ipAddress,
      connectionDuration: null,
    })

    eventBusInstance.emit({
      type: 'device.connected',
      timestamp: nowIso(),
      payload: {
        deviceId: device.id,
        macAddress: mac,
        ipAddress: d.ipAddress,
        hostname: d.hostname ?? undefined,
      },
    })
  }
}

async function recordScanHistory(input: {
  scannerName: string
  durationMs: number
  deviceCount: number
  successCount: number
  failureCount: number
  status: string
  errorMessage: string | null
}): Promise<void> {
  try {
    await db
      .insertInto('network_scan_history')
      .values({
        id: randomUUID(),
        scanner_name: input.scannerName,
        scan_duration: input.durationMs,
        device_count: input.deviceCount,
        success_count: input.successCount,
        failure_count: input.failureCount,
        status: input.status,
        error_message: input.errorMessage,
        created_at: nowIso(),
      })
      .execute()
  } catch (err) {
    // History is observability, not function: never fail a scan over it.
    logger.error({ err }, 'failed to record scan history')
  }
}
