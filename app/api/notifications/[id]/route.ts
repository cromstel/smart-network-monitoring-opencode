import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/errors'
import { markNotificationRead } from '@/lib/services/alertService'

interface RouteContext {
  params: Promise<{ id: string }>
}

export const dynamic = 'force-dynamic'

export async function PATCH(_request: Request, context: RouteContext) {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  let body: { isRead?: boolean }
  try {
    body = await _request.json()
  } catch {
    return apiError(400, 'INVALID_BODY', 'Invalid JSON body')
  }

  if (body.isRead !== true) {
    return apiError(400, 'INVALID_BODY', 'isRead must be true')
  }

  const { id } = await context.params
  const ok = await markNotificationRead(id, auth.user.id)
  if (!ok) {
    return apiError(404, 'NOT_FOUND', 'Notification not found')
  }

  return NextResponse.json({ data: { success: true } })
}
