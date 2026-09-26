import { NextResponse } from 'next/server'
import { getDeviceById, updateDeviceById } from '@/lib/services/deviceService'
import { toDeviceDTO } from '@/lib/api/serialisers'
import { apiError } from '@/lib/api/errors'
import { requireRole, type AuthContext } from '@/lib/services/authService'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const userId = request.headers.get('x-user-id')
  const userRole = request.headers.get('x-user-role')

  const auth: AuthContext | null = userId && userRole ? { id: userId, role: userRole as AuthContext['role'] } : null

  try {
    requireRole(auth, 'VIEWER', 'MEMBER', 'ADMIN')
  } catch (e) {
    return apiError(401, 'UNAUTHENTICATED', 'Authentication required')
  }

  const { id } = await context.params

  const device = await getDeviceById(id)
  if (!device) {
    return apiError(404, 'NOT_FOUND', 'Device not found.')
  }

  return NextResponse.json({ data: toDeviceDTO(device) })
}

export async function PATCH(request: Request, context: RouteContext) {
  const userId = request.headers.get('x-user-id')
  const userRole = request.headers.get('x-user-role')

  const auth: AuthContext | null = userId && userRole ? { id: userId, role: userRole as AuthContext['role'] } : null

  try {
    requireRole(auth, 'ADMIN', 'MEMBER')
  } catch (e) {
    return apiError(401, 'UNAUTHENTICATED', 'Authentication required')
  }

  const { id } = await context.params

  let body: { deviceName?: string; deviceType?: string }
  try {
    body = await request.json()
  } catch {
    return apiError(400, 'INVALID_BODY', 'Invalid JSON body')
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
      return apiError(400, 'INVALID_BODY', 'Invalid device type')
    }
    patch.deviceType = body.deviceType
  }

  if (Object.keys(patch).length === 0) {
    return apiError(400, 'INVALID_BODY', 'No valid fields to update')
  }

  const updated = await updateDeviceById(id, patch)

  if (!updated) {
    return apiError(404, 'NOT_FOUND', 'Device not found.')
  }

  const device = await getDeviceById(id)
  if (!device) {
    return apiError(404, 'NOT_FOUND', 'Device not found after update.')
  }

  return NextResponse.json({ data: toDeviceDTO(device) })
}