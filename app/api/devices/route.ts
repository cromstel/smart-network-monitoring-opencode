import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { listDevices } from '@/lib/services/deviceService'
import { toDeviceDTO } from '@/lib/api/serialisers'
import { requireAuth } from '@/lib/api/auth'
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
  const authResult = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])

  if (authResult instanceof NextResponse) {
    return authResult
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  )

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'INVALID_QUERY',
        message: 'Invalid query parameters',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    )
  }

  const filters: DeviceFilters = { ...parsed.data }
  const result = await listDevices(filters)

  return NextResponse.json({
    data: result.data.map(toDeviceDTO),
    pagination: result.pagination,
  })
}