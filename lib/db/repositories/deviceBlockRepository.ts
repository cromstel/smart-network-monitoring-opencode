import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { db } from '../client'

/**
 * Site/app blocking rules — the `device_blocks` half of the firewall.
 *
 * The other half is `devices.is_blocked` (block the whole device), which lives
 * on the devices row and is written through `deviceRepository.update`. The two
 * are deliberately separate: a blocked device is off the network entirely,
 * while a rule here blocks one destination for one device.
 *
 * Every function returns plain objects (no Kysely rows), so no caller can
 * accidentally pass a driver-specific value back into a query.
 */

export interface DeviceBlockInput {
  deviceId: string
  websiteApp: string
  createdBy: string
}

export interface DeviceBlock {
  id: string
  deviceId: string
  websiteApp: string
  isActive: boolean
  createdBy: string
  createdAt: string
}

/** A rule plus the fields needed to label it in the UI, in one query. */
export interface DeviceBlockWithDevice extends DeviceBlock {
  deviceLabel: string
  macAddress: string
  ipAddress: string
}

const MAX_WEBSITE_APP_LENGTH = 255

function toBool(value: unknown): boolean {
  return Number(value) === 1
}

export async function createBlock(input: DeviceBlockInput): Promise<DeviceBlock> {
  const id = randomUUID()
  const now = new Date().toISOString()
  await db
    .insertInto('device_blocks')
    .values({
      id,
      device_id: input.deviceId,
      website_app: input.websiteApp,
      is_active: 1,
      created_by: input.createdBy,
      created_at: now,
    })
    .execute()

  return { id, ...input, isActive: true, createdAt: now }
}

export async function deleteBlock(id: string): Promise<boolean> {
  // Read first, then delete. The affected-row count is not portable: Kysely
  // hands back mysql2's raw OkPacket, which exposes the counter under a
  // numeric index (and as a BigInt with `supportBigNumbers`), not as the
  // `affectedRows` field the UpdateResult type advertises — so
  // `Number(result.affectedRows)` silently reads 0 and every delete would
  // look like it deleted nothing. A SELECT is also the shape the rest of this
  // codebase uses (see `deviceRepository.update`).
  const existing = await findBlockById(id)
  if (!existing) return false

  await db.deleteFrom('device_blocks').where('id', '=', id).execute()
  return true
}

export async function findBlocksByDevice(deviceId: string): Promise<DeviceBlock[]> {
  const rows = await db
    .selectFrom('device_blocks')
    .where('device_id', '=', deviceId)
    .where('is_active', '=', 1)
    .selectAll()
    .execute()

  return rows.map(mapRow)
}

export async function findBlockById(id: string): Promise<DeviceBlock | null> {
  const row = await db
    .selectFrom('device_blocks')
    .where('id', '=', id)
    .selectAll()
    .executeTakeFirst()

  return row ? mapRow(row) : null
}

/**
 * An active rule for the same device and target, compared case-insensitively.
 *
 * The comparison lowercases both sides instead of relying on the column
 * collation: the deployed server is `utf8mb4_uca1400_ai_ci` (already
 * case-insensitive, so this is belt-and-braces there) but any CI or staging
 * database created with a binary collation would otherwise accept
 * `Facebook.com` and `facebook.com` as two different rules.
 */
export async function findActiveDuplicate(
  deviceId: string,
  websiteApp: string,
): Promise<DeviceBlock | null> {
  const target = websiteApp.trim().toLowerCase()
  const row = await db
    .selectFrom('device_blocks')
    .where('device_id', '=', deviceId)
    .where('is_active', '=', 1)
    .where(sql<boolean>`lower(website_app) = ${target}`)
    .selectAll()
    .executeTakeFirst()

  return row ? mapRow(row) : null
}

/**
 * Flips a rule's active flag. Unknown ids return null rather than throwing, so
 * the route can answer 404 without a second lookup.
 *
 * Read-then-write for the same reason as `deleteBlock`: the update's
 * affected-row count is not readable through Kysely's MySQL result, and it
 * would report "no such rule" for a rule that exists.
 */
export async function setBlockActive(id: string, isActive: boolean): Promise<DeviceBlock | null> {
  const existing = await findBlockById(id)
  if (!existing) return null
  if (existing.isActive === isActive) return existing

  await db
    .updateTable('device_blocks')
    .set({ is_active: isActive ? 1 : 0 })
    .where('id', '=', id)
    .execute()

  return findBlockById(id)
}

/**
 * All rules, newest first, each carrying the device fields the UI needs to
 * label it.
 *
 * One query with a join, not a per-rule device lookup: the page renders the
 * whole table at once, and N+1 over a growing rule set is the pattern the rest
 * of this codebase deliberately avoids (see `fetchStatsForDevices`).
 *
 * `coalesce` mirrors the visible-label chain the device table uses, so a rule
 * row and a device row can never disagree about a device's name.
 */
export async function listBlocksWithDevices(): Promise<DeviceBlockWithDevice[]> {
  const rows = await db
    .selectFrom('device_blocks as b')
    .innerJoin('devices as d', 'd.id', 'b.device_id')
    .select([
      'b.id',
      'b.device_id',
      'b.website_app',
      'b.is_active',
      'b.created_by',
      'b.created_at',
      sql<string>`coalesce(d.device_name, d.hostname, d.mac_address)`.as('device_label'),
      'd.mac_address',
      'd.ip_address',
    ])
    .orderBy('b.created_at', 'desc')
    .execute()

  return rows.map((r) => ({
    id: r.id as string,
    deviceId: r.device_id as string,
    websiteApp: r.website_app as string,
    isActive: toBool(r.is_active),
    createdBy: r.created_by as string,
    createdAt: r.created_at as string,
    deviceLabel: r.device_label as string,
    macAddress: r.mac_address as string,
    ipAddress: r.ip_address as string,
  }))
}

function mapRow(row: {
  id: string
  device_id: string
  website_app: string
  is_active: unknown
  created_by: string
  created_at: string
}): DeviceBlock {
  return {
    id: row.id,
    deviceId: row.device_id,
    websiteApp: row.website_app,
    isActive: toBool(row.is_active),
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}
