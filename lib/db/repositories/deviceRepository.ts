import { randomUUID } from 'node:crypto'
import { sql, type ExpressionBuilder } from 'kysely'
import { db } from '../client'
import type { DB } from '../schema'
import type {
  Device,
  DeviceFilters,
  DeviceListResult,
  DeviceStatus,
} from '@/lib/types'
import { rowToDevice } from './mappers'

function findSet<T extends string>(value: T | undefined): value is T {
  return value !== undefined && value !== ''
}

/**
 * Matches the search term against name, hostname, IP and MAC.
 *
 * Two things this gets right that the obvious implementation does not:
 *
 * 1. **Case-insensitive.** `LIKE` is case-sensitive on MySQL when the column
 *    collation is `utf8mb4_bin`-like, and case-insensitive on SQLite's default
 *    `BINARY` collation only by accident of ASCII. Users type `nas`, `NAS` and
 *    `Nas` interchangeably and expect the same three results. So the term is
 *    lowercased and the columns are lowercased to match, which is portable
 *    across both dialects without relying on either one's collation defaults.
 *
 * 2. **The term is escaped.** A search for `50%` or `_foo` would otherwise be
 *    interpreted as a LIKE wildcard and match rows the user did not ask for.
 *    `%` and `_` are escaped with an explicit escape character.
 */
function searchFilter(search: string) {
  const term = search.trim().toLowerCase()
  // Escape the LIKE metacharacters so they are matched literally. A user
  // searching for `50%` or a hostname containing `_` means those characters,
  // not wildcards.
  //
  // The escape character is `\` rather than the SQL-standard default for a
  // reason that cost a debugging cycle: the default IS `\`, so writing
  // `ESCAPE '\'` looks like a no-op and is easy to get wrong in a JS template
  // literal, where the doubling rules differ from SQL's. SQLite rejects
  // anything that is not exactly one character, so a mis-escaped clause fails
  // loudly rather than silently — which is better, but still a trap. Naming the
  // character in a constant keeps the JS escaping and the SQL literal in view
  // together.
  const ESCAPE = '\\'
  const escaped = term.replace(/([\\%_])/g, (m) => `${ESCAPE}${m}`)
  const like = `%${escaped}%`

  // Written as raw SQL because Kysely's `eb(col, 'like', value)` form has no
  // slot for an ESCAPE clause, and silently dropping the escaping is worse than
  // a few lines of SQL.
  return (eb: ExpressionBuilder<DB, 'devices'>) =>
    eb.or([
      sql<boolean>`lower(device_name) like ${like} escape ${ESCAPE}`,
      sql<boolean>`lower(hostname) like ${like} escape ${ESCAPE}`,
      sql<boolean>`lower(ip_address) like ${like} escape ${ESCAPE}`,
      sql<boolean>`lower(mac_address) like ${like} escape ${ESCAPE}`,
    ])
}

export async function listDevices(filters: DeviceFilters = {}): Promise<DeviceListResult> {
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50))
  const direction = filters.order === 'asc' ? 'asc' : 'desc'
  const search = filters.search?.trim()

  let countQuery = db.selectFrom('devices').select(db.fn.countAll<number>().as('count'))
  let dataQuery = db.selectFrom('devices').selectAll()

  if (findSet(filters.status)) {
    countQuery = countQuery.where('status', '=', filters.status)
    dataQuery = dataQuery.where('status', '=', filters.status)
  }
  if (findSet(filters.type)) {
    countQuery = countQuery.where('device_type', '=', filters.type)
    dataQuery = dataQuery.where('device_type', '=', filters.type)
  }
  if (findSet(filters.categoryId)) {
    countQuery = countQuery.where('category_id', '=', filters.categoryId)
    dataQuery = dataQuery.where('category_id', '=', filters.categoryId)
  }
  if (search) {
    countQuery = countQuery.where(searchFilter(search))
    dataQuery = dataQuery.where(searchFilter(search))
  }

  const countRow = await countQuery.executeTakeFirstOrThrow()

  if (filters.sort === 'name') {
    dataQuery = dataQuery.orderBy('device_name', direction)
  } else {
    dataQuery = dataQuery.orderBy('last_seen', direction)
  }

  const rows = await dataQuery
    .orderBy('mac_address', 'asc')
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .execute()

  return {
    data: rows.map(rowToDevice),
    pagination: { page, pageSize, total: Number(countRow.count) },
  }
}

export function findById(id: string): Promise<Device | null> {
  return db
    .selectFrom('devices')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
    .then((row) => (row ? rowToDevice(row) : null))
}

export interface DevicePatch {
  deviceName?: string | null
  deviceType?: string
  categoryId?: string | null
  isIgnored?: boolean
}

export async function update(id: string, patch: DevicePatch): Promise<Device | null> {
  const existing = await findById(id)
  if (!existing) return null

  const now = new Date().toISOString()
  const set: Record<string, string | number | null> = { updated_at: now }

  if ('deviceName' in patch) set.device_name = patch.deviceName ?? null
  if ('deviceType' in patch) set.device_type = patch.deviceType ?? 'unknown'
  if ('categoryId' in patch) set.category_id = patch.categoryId ?? null
  if ('isIgnored' in patch) set.is_ignored = patch.isIgnored ? 1 : 0

  await db.updateTable('devices').set(set).where('id', '=', id).execute()

  return findById(id)
}

export interface ScanDeviceInput {
  macAddress: string
  ipAddress: string
  hostname: string | null
  manufacturer: string | null
  signalStrength?: number | null
}

function isMysql(): boolean {
  return process.env.DB_CLIENT === 'mysql'
}

export async function upsertFromScan(input: ScanDeviceInput): Promise<void> {
  const now = new Date().toISOString()

  // Upsert is spelled differently per dialect. Kysely's onConflict() emits
  // SQLite/Postgres `on conflict (...) do update set`, which MySQL rejects with
  // a parse error — it wants `on duplicate key update` and takes the conflict
  // target from the unique key instead of naming a column. Every scan cycle
  // goes through here, so this broke the entire device scan on MySQL.
  const values = {
    ip_address: input.ipAddress,
    hostname: input.hostname,
    manufacturer: input.manufacturer,
    signal_strength: input.signalStrength ?? null,
    status: 'online' as const,
    last_seen: now,
    updated_at: now,
  }

  if (isMysql()) {
    await db
      .insertInto('devices')
      .values({
        id: randomUUID(),
        mac_address: input.macAddress.toUpperCase(),
        ip_address: input.ipAddress,
        hostname: input.hostname,
        manufacturer: input.manufacturer,
        signal_strength: input.signalStrength ?? null,
        status: 'online',
        first_seen: now,
        last_seen: now,
        created_at: now,
        updated_at: now,
      })
      .onDuplicateKeyUpdate(values)
      .execute()
    return
  }

  await db
    .insertInto('devices')
    .values({
      id: randomUUID(),
      mac_address: input.macAddress.toUpperCase(),
      ip_address: input.ipAddress,
      hostname: input.hostname,
      manufacturer: input.manufacturer,
      signal_strength: input.signalStrength ?? null,
      status: 'online',
      first_seen: now,
      last_seen: now,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) => oc.column('mac_address').doUpdateSet(values))
    .execute()
}

export async function findOnlineLastSeenBefore(cutoff: Date): Promise<Device[]> {
  const rows = await db
    .selectFrom('devices')
    .selectAll()
    .where('status', '=', 'online')
    .where('last_seen', '<', cutoff.toISOString())
    .execute()

  return rows.map(rowToDevice)
}

export async function updateStatus(id: string, status: DeviceStatus): Promise<void> {
  await db
    .updateTable('devices')
    .set({ status, updated_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute()
}

export async function findAllMacAddresses(): Promise<string[]> {
  const rows = await db
    .selectFrom('devices')
    .select('mac_address')
    .execute()
  return rows.map((r) => r.mac_address)
}

export async function findByMac(macAddress: string): Promise<Device | null> {
  const row = await db
    .selectFrom('devices')
    .selectAll()
    .where('mac_address', '=', macAddress.toUpperCase())
    .executeTakeFirst()

  return row ? rowToDevice(row) : null
}

export async function updateFromScan(id: string, ipAddress: string, hostname: string | null): Promise<void> {
  const now = new Date().toISOString()
  await db
    .updateTable('devices')
    .set({
      ip_address: ipAddress,
      hostname: hostname,
      status: 'online',
      last_seen: now,
      updated_at: now,
    })
    .where('id', '=', id)
    .execute()
}