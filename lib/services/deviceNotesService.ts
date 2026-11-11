import * as deviceNoteRepo from '@/lib/db/repositories/deviceNotesRepository'
import type { DeviceNote } from '@/lib/db/repositories/deviceNotesRepository'

/**
 * Device notes service — manages user notes attached to devices.
 * Notes are used for documentation and collaboration between admins.
 */

export async function createDeviceNote(input: {
  deviceId: string
  userId: string
  note: string
}): Promise<DeviceNote> {
  return deviceNoteRepo.createDeviceNote(input)
}

export async function listDeviceNotes(deviceId: string): Promise<DeviceNote[]> {
  return deviceNoteRepo.listDeviceNotes(deviceId)
}

export async function updateDeviceNote(
  id: string,
  userId: string,
  note: string
): Promise<DeviceNote | null> {
  return deviceNoteRepo.updateDeviceNote(id, userId, note)
}

export async function deleteDeviceNote(id: string, userId: string): Promise<boolean> {
  return deviceNoteRepo.deleteDeviceNote(id, userId)
}
