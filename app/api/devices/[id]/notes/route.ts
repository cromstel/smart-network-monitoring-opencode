import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { createDeviceNote, listDeviceNotes, updateDeviceNote, deleteDeviceNote } from '@/lib/services/deviceNotesService'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  const { searchParams } = new URL(request.url)
  const deviceId = searchParams.get('deviceId')

  if (!deviceId) {
    return NextResponse.json({ error: 'MISSING_DEVICE_ID', message: 'deviceId query parameter is required' }, { status: 400 })
  }

  const notes = await listDeviceNotes(deviceId)
  return NextResponse.json({ data: notes })
}

export async function POST(request: Request) {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  const body = await request.json().catch(() => ({}))
  const { deviceId, note } = body

  if (!deviceId || !note) {
    return NextResponse.json({ error: 'MISSING_FIELDS', message: 'deviceId and note are required' }, { status: 400 })
  }

  const noteRecord = await createDeviceNote({ deviceId, userId: auth.user.id, note })
  return NextResponse.json({ data: noteRecord }, { status: 201 })
}

export async function PATCH(request: Request) {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'MISSING_ID', message: 'id query parameter is required' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const { note } = body

  if (!note) {
    return NextResponse.json({ error: 'MISSING_NOTE', message: 'note is required' }, { status: 400 })
  }

  const updated = await updateDeviceNote(id, auth.user.id, note)
  if (!updated) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'Note not found or not owned by user' }, { status: 404 })
  }

  return NextResponse.json({ data: updated })
}

export async function DELETE(request: Request) {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'MISSING_ID', message: 'id query parameter is required' }, { status: 400 })
  }

  const deleted = await deleteDeviceNote(id, auth.user.id)
  if (!deleted) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'Note not found or not owned by user' }, { status: 404 })
  }

  return NextResponse.json({ data: { deleted: true } })
}
