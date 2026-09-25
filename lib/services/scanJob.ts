import { selectScanner } from './scanners/selector'
import { upsertFromScan, findAllMacAddresses } from '@/lib/db/repositories/deviceRepository'
import { insert as insertConnectionLog } from '@/lib/db/repositories/connectionLogRepository'
import { findOnlineLastSeenBefore } from '@/lib/db/repositories/deviceRepository'
import { updateStatus } from '@/lib/db/repositories/deviceRepository'
import { db } from '@/lib/db/client'
import { getConfig } from '@/lib/config'
import { logger } from '@/lib/utils/logger'
import type { DiscoveredDevice } from './scanners/types'
import { lookupVendor, normalizeMac } from './oui'

export interface ScanResult {
  scanner: string
  durationMs: number
  devicesFound: number
  newDevices: number
  wentOffline: number
}

async function scanOnce(): Promise<ScanResult> {
  const start = Date.now()
  const cfg = getConfig()
  const scanner = await selectScanner()
  const subnet = cfg.NETWORK_SUBNET

  logger.info({ scanner: scanner.name, subnet }, 'starting network scan')

  const knownMacs = new Set(await findAllMacAddresses())
  const discovered = await scanner.scan(subnet)
  let newDevices = 0
  let connectedCount = 0

  for (const d of discovered) {
    const mac = normalizeMac(d.macAddress)
    const isNew = !knownMacs.has(mac)
    const vendor = lookupVendor(mac) ?? d.manufacturer ?? null

    await upsertFromScan({
      macAddress: mac,
      ipAddress: d.ipAddress,
      hostname: d.hostname ?? null,
      manufacturer: vendor,
      signalStrength: d.signalStrength ?? null,
    })

    if (isNew) {
      newDevices += 1
      const inserted = await db
        .selectFrom('devices')
        .select('id')
        .where('mac_address', '=', mac)
        .executeTakeFirst()
      if (inserted) {
        await insertConnectionLog({
          deviceId: inserted.id,
          eventType: 'connected',
          timestamp: new Date(),
          ipAddress: d.ipAddress,
          connectionDuration: null,
        })
        connectedCount += 1
      }
    }
  }

  const wentOffline = await markStaleOffline()

  const durationMs = Date.now() - start
  logger.info(
    { scanner: scanner.name, durationMs, devicesFound: discovered.length, newDevices, connectedCount, wentOffline },
    'scan completed'
  )

  await db
    .insertInto('network_scan_history')
    .values({
      id: crypto.randomUUID(),
      scanner_name: scanner.name,
      scan_duration: durationMs,
      device_count: discovered.length,
      success_count: newDevices,
      failure_count: 0,
      status: 'success',
      error_message: null,
      created_at: new Date().toISOString(),
    })
    .execute()

  return { scanner: scanner.name, durationMs, devicesFound: discovered.length, newDevices, wentOffline }
}

async function markStaleOffline(): Promise<number> {
  const cfg = getConfig()
  const cutoff = new Date(Date.now() - cfg.SCAN_INTERVAL_SECONDS * 2 * 1000)
  const stale = await findOnlineLastSeenBefore(cutoff)

  for (const d of stale) {
    await updateStatus(d.id, 'offline')
    await insertConnectionLog({
      deviceId: d.id,
      eventType: 'disconnected',
      timestamp: new Date(),
      ipAddress: d.ipAddress,
      connectionDuration: Math.max(0, Math.floor((Date.now() - d.lastSeen.getTime()) / 1000)),
    })
  }
  return stale.length
}

export { scanOnce, markStaleOffline }