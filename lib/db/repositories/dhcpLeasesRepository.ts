import { randomUUID } from 'node:crypto'
import { db } from '../client'
import type { DhcpLeasesTable } from '../schema'
import type { Selectable } from 'kysely'

export interface DhcpLease {
  id: string
  deviceId: string
  ipAddress: string
  macAddress: string
  hostname: string | null
  leaseStart: string
  leaseEnd: string | null
  isActive: boolean
  createdAt: string
}

function rowToLease(row: Selectable<DhcpLeasesTable>): DhcpLease {
  return {
    id: row.id,
    deviceId: row.device_id,
    ipAddress: row.ip_address,
    macAddress: row.mac_address,
    hostname: row.hostname,
    leaseStart: row.lease_start,
    leaseEnd: row.lease_end,
    isActive: Number(row.is_active) === 1,
    createdAt: row.created_at,
  }
}

export async function createLease(input: {
  deviceId: string
  ipAddress: string
  macAddress: string
  hostname: string | null
  leaseStart: string
  leaseEnd: string | null
}): Promise<DhcpLease> {
  const id = randomUUID()
  await db
    .insertInto('dhcp_leases')
    .values({
      id,
      device_id: input.deviceId,
      ip_address: input.ipAddress,
      mac_address: input.macAddress,
      hostname: input.hostname,
      lease_start: input.leaseStart,
      lease_end: input.leaseEnd,
      is_active: 1,
      created_at: new Date().toISOString(),
    })
    .execute()

  const row = await db
    .selectFrom('dhcp_leases')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  if (!row) throw new Error('DHCP lease insert did not persist')
  return rowToLease(row)
}

export async function listLeases(options?: { activeOnly?: boolean }): Promise<DhcpLease[]> {
  let query = db.selectFrom('dhcp_leases').selectAll().orderBy('created_at', 'desc')
  if (options?.activeOnly) {
    query = query.where('is_active', '=', 1)
  }
  const rows = await query.execute()
  return rows.map(rowToLease)
}

export async function markLeaseInactive(id: string): Promise<boolean> {
  const result = await db
    .updateTable('dhcp_leases')
    .set({ is_active: 0 })
    .where('id', '=', id)
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0) > 0
}

export async function deactivateLeasesForMac(macAddress: string): Promise<void> {
  await db
    .updateTable('dhcp_leases')
    .set({ is_active: 0 })
    .where('mac_address', '=', macAddress.toUpperCase())
    .execute()
}

export async function findLeaseByMac(macAddress: string): Promise<DhcpLease | null> {
  const row = await db
    .selectFrom('dhcp_leases')
    .selectAll()
    .where('mac_address', '=', macAddress.toUpperCase())
    .where('is_active', '=', 1)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()
  return row ? rowToLease(row) : null
}

export async function findLeaseByIp(ipAddress: string): Promise<DhcpLease | null> {
  const row = await db
    .selectFrom('dhcp_leases')
    .selectAll()
    .where('ip_address', '=', ipAddress)
    .where('is_active', '=', 1)
    .executeTakeFirst()
  return row ? rowToLease(row) : null
}
