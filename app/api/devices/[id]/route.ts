import { NextResponse } from 'next/server'
import { getDeviceById } from '@/lib/services/deviceService'
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