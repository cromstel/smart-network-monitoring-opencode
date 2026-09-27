import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/errors'
import { deleteAlert } from '@/lib/services/alertService'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params

  // Scoped to the caller's own rules: another user's id simply is not found.
  const removed = await deleteAlert(id, auth.user.id)
  if (!removed) {
    return apiError(404, 'NOT_FOUND', 'Alert rule not found')
  }

  return NextResponse.json({ data: { success: true } })
}
