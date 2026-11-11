import { randomUUID } from 'node:crypto'
import { db } from '../client'
import type { AuditLogsTable } from '../schema'
import type { Selectable } from 'kysely'

export interface AuditLog {
  id: string
  userId: string
  action: string
  resourceType: string
  resourceId: string | null
  oldValues: string | null
  newValues: string | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
}

function rowToAuditLog(row: Selectable<AuditLogsTable>): AuditLog {
  return {
    id: row.id,
    userId: row.user_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    oldValues: row.old_values,
    newValues: row.new_values,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  }
}

export async function createAuditLog(input: {
  userId: string
  action: string
  resourceType: string
  resourceId?: string | null
  oldValues?: string | null
  newValues?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}): Promise<AuditLog> {
  const id = randomUUID()
  await db
    .insertInto('audit_logs')
    .values({
      id,
      user_id: input.userId,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId ?? null,
      old_values: input.oldValues ?? null,
      new_values: input.newValues ?? null,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      created_at: new Date().toISOString(),
    })
    .execute()

  const row = await db
    .selectFrom('audit_logs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  if (!row) throw new Error('Audit log insert did not persist')
  return rowToAuditLog(row)
}

export async function listAuditLogs(options?: {
  userId?: string
  action?: string
  resourceType?: string
  resourceId?: string
  limit?: number
  offset?: number
}): Promise<AuditLog[]> {
  let query = db.selectFrom('audit_logs').selectAll().orderBy('created_at', 'desc')

  if (options?.userId) query = query.where('user_id', '=', options.userId)
  if (options?.action) query = query.where('action', '=', options.action)
  if (options?.resourceType) query = query.where('resource_type', '=', options.resourceType)
  if (options?.resourceId) query = query.where('resource_id', '=', options.resourceId)
  if (options?.limit) query = query.limit(options.limit)
  if (options?.offset) query = query.offset(options.offset)

  const rows = await query.execute()
  return rows.map(rowToAuditLog)
}

export async function countAuditLogs(options?: {
  userId?: string
  action?: string
  resourceType?: string
}): Promise<number> {
  let query = db.selectFrom('audit_logs').select(db.fn.countAll<number>().as('count'))

  if (options?.userId) query = query.where('user_id', '=', options.userId)
  if (options?.action) query = query.where('action', '=', options.action)
  if (options?.resourceType) query = query.where('resource_type', '=', options.resourceType)

  const row = await query.executeTakeFirst()
  return Number(row?.count ?? 0)
}
