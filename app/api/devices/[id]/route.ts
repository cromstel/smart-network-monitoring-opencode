import { NextResponse } from 'next/server'
import { getDeviceById, updateDeviceById } from '@/lib/services/deviceService'
import { toDeviceDTO } from '@/lib/api/serialisers'
import { requireAuth } from '@/lib/api/auth'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const authResult = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])

  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { id } = await context.params

  const device = await getDeviceById(id)
  if (!device) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'Device not found.' },
      { status: 404 }
    )
  }

  return NextResponse.json({ data: toDeviceDTO(device) })
}

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireAuth(['ADMIN', 'MEMBER'])

  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { id } = await context.params

  let body: { deviceName?: string; deviceType?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'INVALID_BODY', message: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  const allowedTypes = [
    'phone', 'tablet', 'laptop', 'desktop', 'tv', 'speaker',
    'printer', 'camera', 'server', 'switch', 'router', 'iot', 'unknown',
  ]

  const patch: { deviceName?: string | null; deviceType?: string } = {}

  if (body.deviceName !== undefined) {
    patch.deviceName = body.deviceName || null
  }

  if (body.deviceType !== undefined) {
    if (!allowedTypes.includes(body.deviceType)) {
      return NextResponse.json(
        { error: 'INVALID_BODY', message: 'Invalid device type' },
        { status: 400 }
      )
    }
    patch.deviceType = body.deviceType
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'INVALID_BODY', message: 'No valid fields to update' },
      { status: 400 }
    )
  }

  const updated = await updateDeviceById(id, patch)

  if (!updated) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'Device not found.' },
      { status: 404 }
    )
  }

  const device = await getDeviceById(id)
  if (!device) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'Device not found after update.' },
      { status: 404 }
    )
  }

  return NextResponse.json({ data: toDeviceDTO(device) })
}