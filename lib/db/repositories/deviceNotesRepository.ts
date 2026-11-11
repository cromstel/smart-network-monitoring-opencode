import { randomUUID } from 'node:crypto'
import { db } from '../client'
import type { DeviceNotesTable } from '../schema'
import type { Selectable } from 'kysely'

export interface DeviceNote {
  id: string
  deviceId: string
  userId: string
  note: string
  createdAt: string
  updatedAt: string
}

function rowToDeviceNote(row: Selectable<DeviceNotesTable>): DeviceNote {
  return {
    id: row.id,
    deviceId: row.device_id,
    userId: row.user_id,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function createDeviceNote(input: {
  deviceId: string
  userId: string
  note: string
}): Promise<DeviceNote> {
  const id = randomUUID()
  const now = new Date().toISOString()
  await db
    .insertInto('device_notes')
    .values({
      id,
      device_id: input.deviceId,
      user_id: input.userId,
      note: input.note,
      created_at: now,
      updated_at: now,
    })
    .execute()

  const row = await db
    .selectFrom('device_notes')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  if (!row) throw new Error('Device note insert did not persist')
  return rowToDeviceNote(row)
}

export async function listDeviceNotes(deviceId: string): Promise<DeviceNote[]> {
  const rows = await db
    .selectFrom('device_notes')
    .selectAll()
    .where('device_id', '=', deviceId)
    .orderBy('created_at', 'desc')
    .execute()
  return rows.map(rowToDeviceNote)
}

export async function updateDeviceNote(
  id: string,
  userId: string,
  note: string
): Promise<DeviceNote | null> {
  const now = new Date().toISOString()
  await db
    .updateTable('device_notes')
    .set({ note, updated_at: now })
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .execute()

  const row = await db
    .selectFrom('device_notes')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  if (!row) return null
  return rowToDeviceNote(row)
}

export async function deleteDeviceNote(id: string, userId: string): Promise<boolean> {
  const result = await db
    .deleteFrom('device_notes')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return Number(result?.numDeletedRows ?? 0) > 0
}
