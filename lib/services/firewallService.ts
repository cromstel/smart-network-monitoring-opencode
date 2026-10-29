import * as blockRepo from '@/lib/db/repositories/deviceBlockRepository'
import * as deviceRepo from '@/lib/db/repositories/deviceRepository'
import { eventBusInstance, type FirewallBlockedEvent } from '@/lib/services/eventBus'
import { logger } from '@/lib/utils/logger'
import type { Device } from '@/lib/types'

/**
 * The firewall: blocking devices and blocking destinations.
 *
 * Two independent mechanisms, one screen:
 *
 *   - **Device blocking** — `devices.is_blocked`. The device is off the
 *     network: it cannot connect, and the device table labels it "Blocked".
 *   - **Rules** — `device_blocks`. One destination (a site or app hostname)
 *     blocked for one device, with the device still usable.
 *
 * ## Why the checks live here and not in the routes
 *
 * Both writes sit behind foreign keys, and a raw route-level insert would turn
 * "no such device" into a driver constraint error at best and a 500 at worst.
 * The service validates first (device exists, target non-empty and within the
 * column, no duplicate active rule) and raises a typed `FirewallError` whose
 * `code` maps straight onto `lib/api/errors.ts`'s codes — the route stays a
 * thin translator, and the same rules apply to any future caller (a scanner,
 * a router push-down, the E2E seed).
 *
 * ## Why duplicates are rejected instead of stacked
 *
 * Two active rules for the same device+target mean the same thing twice, and
 * the toggle on either one would appear to do nothing while the other kept the
 * target blocked. One active rule per target, case-insensitive: deactivate the
 * existing rule to re-create it (which preserves the history of when it was
 * first added).
 */

export interface FirewallRule {
  id: string
  deviceId: string
  /** The name the UI shows for the device: name, then hostname, then MAC. */
  deviceLabel: string
  macAddress: string
  ipAddress: string
  websiteApp: string
  isActive: boolean
  createdBy: string
  createdAt: string
}

/** `code` values are the ones `lib/api/errors.ts` already defines and serves. */
export type FirewallErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'INVALID_BODY'

export class FirewallError extends Error {
  readonly code: FirewallErrorCode

  constructor(code: FirewallErrorCode, message: string) {
    super(message)
    this.name = 'FirewallError'
    this.code = code
  }
}

/** The `device_blocks.website_app` column. Enforced here so the failure names
 *  the field instead of surfacing as a truncation error from the driver. */
const MAX_TARGET_LENGTH = 255

function deviceLabel(device: {
  deviceName: string | null
  hostname: string | null
  macAddress: string
}): string {
  return device.deviceName || device.hostname || device.macAddress
}

/**
 * Tells the admin group a block landed.
 *
 * Fire-and-forget: the bus handler is synchronous, and a notification problem
 * must not fail the firewall write that succeeded a moment ago. `emit` itself
 * catches handler errors, but the emit is wrapped anyway so a future bus
 * change (an async emit, a throwing logger) cannot turn a successful block
 * into a 500 for the user who requested it.
 */
function emitFirewallBlocked(payload: FirewallBlockedEvent['payload']): void {
  try {
    const event: FirewallBlockedEvent = {
      type: 'firewall.blocked',
      timestamp: new Date().toISOString(),
      payload,
    }
    eventBusInstance.emit(event)
  } catch (err) {
    logger.error({ err, payload }, 'failed to emit firewall.blocked event')
  }
}

export async function listRules(): Promise<FirewallRule[]> {
  const rows = await blockRepo.listBlocksWithDevices()
  return rows.map((r) => ({
    id: r.id,
    deviceId: r.deviceId,
    deviceLabel: r.deviceLabel,
    macAddress: r.macAddress,
    ipAddress: r.ipAddress,
    websiteApp: r.websiteApp,
    isActive: r.isActive,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  }))
}

export async function createRule(input: {
  deviceId: string
  websiteApp: string
  userId: string
}): Promise<FirewallRule> {
  const target = (input.websiteApp ?? '').trim()

  if (!target) {
    throw new FirewallError('INVALID_BODY', 'A site or app to block is required')
  }
  if (target.length > MAX_TARGET_LENGTH) {
    throw new FirewallError(
      'INVALID_BODY',
      `A site or app must be at most ${MAX_TARGET_LENGTH} characters`,
    )
  }

  // The insert carries a foreign key to devices; checking first turns a
  // constraint violation into a named 404.
  const device = await deviceRepo.findById(input.deviceId)
  if (!device) {
    throw new FirewallError('NOT_FOUND', 'Device not found')
  }

  const duplicate = await blockRepo.findActiveDuplicate(input.deviceId, target)
  if (duplicate) {
    throw new FirewallError(
      'CONFLICT',
      `${deviceLabel(device)} already has an active rule for ${target}`,
    )
  }

  const created = await blockRepo.createBlock({
    deviceId: input.deviceId,
    websiteApp: target,
    createdBy: input.userId,
  })

  emitFirewallBlocked({
    deviceId: input.deviceId,
    deviceLabel: deviceLabel(device),
    action: 'rule_created',
    target,
    actorUserId: input.userId,
  })

  return {
    ...created,
    deviceLabel: deviceLabel(device),
    macAddress: device.macAddress,
    ipAddress: device.ipAddress,
  }
}

export async function setRuleActive(id: string, isActive: boolean): Promise<FirewallRule | null> {
  const updated = await blockRepo.setBlockActive(id, isActive)
  if (!updated) return null

  // The toggle response carries the label too, so the client can replace the
  // row in place without a follow-up fetch of the whole table.
  const device = await deviceRepo.findById(updated.deviceId)
  return {
    ...updated,
    deviceLabel: device ? deviceLabel(device) : updated.deviceId,
    macAddress: device?.macAddress ?? '',
    ipAddress: device?.ipAddress ?? '',
  }
}

export async function deleteRule(id: string): Promise<boolean> {
  return blockRepo.deleteBlock(id)
}

/**
 * Blocks or unblocks a device entirely. Unknown ids return null so the route
 * answers 404; a null device is the only failure mode, so there is no
 * FirewallError to raise here.
 *
 * `actorUserId` is optional so existing two-argument callers (the tests) keep
 * compiling; the route passes the signed-in admin so the fan-out can exclude
 * them from their own action's notification. Only a *block* emits — an
 * unblock is the restoration of normal service, not a security event.
 */
export async function setDeviceBlocked(
  deviceId: string,
  isBlocked: boolean,
  actorUserId?: string
): Promise<Device | null> {
  const device = await deviceRepo.update(deviceId, { isBlocked })

  if (device && isBlocked && actorUserId) {
    emitFirewallBlocked({
      deviceId,
      deviceLabel: deviceLabel(device),
      action: 'device_blocked',
      actorUserId,
    })
  }

  return device
}

export async function listBlockedDevices(): Promise<Device[]> {
  return deviceRepo.findBlocked()
}
