import { randomUUID } from 'node:crypto'
import { db } from '../client'
import type { ConnectionEventType, ConnectionLog } from '@/lib/types'
import { rowToConnectionLog } from './mappers'

export interface ConnectionLogInput {
  deviceId: string
  eventType: ConnectionEventType
  timestamp: Date
  ipAddress?: string | null
  connectionDuration?: number | null
}

export async function insert(input: ConnectionLogInput): Promise<void> {
  const now = new Date().toISOString()
  await db
    .insertInto('connection_logs')
    .values({
      id: randomUUID(),
      device_id: input.deviceId,
      event_type: input.eventType,
      timestamp: input.timestamp.toISOString(),
      ip_address: input.ipAddress ?? null,
      connection_duration: input.connectionDuration ?? null,
      created_at: now,
    })
    .execute()
}

export async function listByDevice(
  deviceId: string,
  limit = 20
): Promise<ConnectionLog[]> {
  const rows = await db
    .selectFrom('connection_logs')
    .selectAll()
    .where('device_id', '=', deviceId)
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .execute()

  return rows.map(rowToConnectionLog)
}