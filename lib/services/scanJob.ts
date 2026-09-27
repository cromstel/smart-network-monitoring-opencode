import { randomUUID } from 'node:crypto'
import { selectScanner } from './scanners/selector'
import { upsertFromScan, findByMac, findAllMacAddresses } from '@/lib/db/repositories/deviceRepository'
import { insert as insertConnectionLog } from '@/lib/db/repositories/connectionLogRepository'
import { db } from '@/lib/db/client'
import { getConfig } from '@/lib/config'
import { logger } from '@/lib/utils/logger'
import { eventBusInstance } from '@/lib/services/eventBus'
import { markStaleDevicesOffline } from '@/lib/services/deviceService'
import { evaluateUnknownDevice, evaluateDeviceOffline } from '@/lib/services/alertService'
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
  const cfg = getConfig()
  const scanner = await selectScanner()

  logger.info({ scanner: scanner.name, subnet: cfg.NETWORK_SUBNET }, 'starting network scan')

  const knownMacs = new Set(await findAllMacAddresses())
  const discovered = await scanner.scan(cfg.NETWORK_SUBNET)

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

  const wentOffline = await markStaleDevicesOffline(cfg.SCAN_INTERVAL_SECONDS)
  if (wentOffline.length > 0) {
    try {
      await evaluateDeviceOffline(wentOffline)
    } catch (err) {
      errors += 1
      logger.error({ err }, 'failed to evaluate offline alerts')
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

/** Test seam — runs a scan against a fixed device list. */
export async function scanWith(scanner: { name: string; scan: (s: string) => Promise<DiscoveredDevice[]> }): Promise<ScanResult> {
  const cfg = getConfig()
  const knownMacs = new Set(await findAllMacAddresses())
  const discovered = await scanner.scan(cfg.NETWORK_SUBNET)

  let newDevices = 0
  for (const d of discovered) {
    await ingest(d, knownMacs, {
      onNew: () => {
        newDevices += 1
      },
      onReconnect: () => undefined,
    })
  }

  return {
    scanner: scanner.name,
    durationMs: 0,
    devicesFound: discovered.length,
    newDevices,
    reconnected: 0,
    wentOffline: 0,
    errors: 0,
  }
}

export type { Device }
