import { randomUUID } from 'node:crypto'
import { db } from '../client'

export interface DeviceBlockInput {
  deviceId: string
  websiteApp: string
  createdBy: string
}

export async function createBlock(input: DeviceBlockInput) {
  const id = randomUUID()
  const now = new Date().toISOString()
  await db.insertInto('device_blocks').values({
    id,
    device_id: input.deviceId,
    website_app: input.websiteApp,
    is_active: 1,
    created_by: input.createdBy,
    created_at: now,
  }).execute()
  return { id, ...input, isActive: true, createdAt: now }
}

export async function deleteBlock(id: string) {
  await db.deleteFrom('device_blocks').where('id', '=', id).execute()
}

export async function findBlocksByDevice(deviceId: string) {
  const rows = await db.selectFrom('device_blocks').where('device_id', '=', deviceId).where('is_active', '=', 1).selectAll().execute()
  return rows.map((r) => ({
    id: r.id as string,
    deviceId: r.device_id as string,
    websiteApp: r.website_app as string,
    isActive: Number(r.is_active) === 1,
    createdBy: r.created_by as string,
    createdAt: r.created_at as string,
  }))
}
