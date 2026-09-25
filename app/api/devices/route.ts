import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { listDevices } from '@/lib/services/deviceService'
import { toDeviceDTO } from '@/lib/api/serialisers'
import { apiError } from '@/lib/api/errors'
import { requireRole, AuthContext } from '@/lib/services/authService'
import type { DeviceFilters } from '@/lib/types'

const querySchema = z.object({
  status: z.enum(['online', 'offline', 'idle']).optional(),
  type: z.string().trim().optional(),
  search: z.string().trim().optional(),
  categoryId: z.string().optional(),
  sort: z.enum(['name', 'lastSeen', 'bandwidth']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  const userRole = request.headers.get('x-user-role')

  const auth: AuthContext | null = userId && userRole
    ? { id: userId, role: userRole as AuthContext['role'] }
    : null

  try {
    requireRole(auth, 'VIEWER', 'MEMBER', 'ADMIN')
  } catch {
    return apiError(401, 'UNAUTHENTICATED', 'Authentication required')
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  )

  if (!parsed.success) {
    return apiError(
      400,
      'INVALID_QUERY',
      'pageSize must be between 1 and 100.',
      parsed.error.flatten()
    )
  }

  const filters: DeviceFilters = { ...parsed.data }
  const result = await listDevices(filters)

  return NextResponse.json({
    data: result.data.map(toDeviceDTO),
    pagination: result.pagination,
  })
}