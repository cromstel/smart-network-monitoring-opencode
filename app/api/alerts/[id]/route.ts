import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/errors'
import { deleteAlert, updateAlert } from '@/lib/services/alertService'
import { KNOWN_ALERT_TYPES, type AlertType } from '@/lib/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

const updateSchema = z
  .object({
    deviceId: z.string().uuid().nullable().optional(),
    alertType: z.enum(KNOWN_ALERT_TYPES).optional(),
    threshold: z.number().nonnegative().max(100_000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'No valid fields to update',
  })

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireAuth(['ADMIN', 'MEMBER'])
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError(400, 'INVALID_BODY', 'Invalid JSON body')
  }

  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', parsed.error.message)
  }

  // Assembled key by key rather than spread. `updateAlert` decides what to
  // write with `'deviceId' in patch`, so forwarding every property — even as
  // `undefined` — would match that test and null a field the caller never
  // mentioned: `{ isActive: false }` alone would silently turn a device-scoped
  // rule into a global one. Only fields actually sent are passed through.
  const input = parsed.data
  const patch: {
    deviceId?: string | null
    alertType?: AlertType
    threshold?: number | null
    isActive?: boolean
  } = {}
  if ('deviceId' in input) patch.deviceId = input.deviceId
  if ('alertType' in input) patch.alertType = input.alertType
  if ('threshold' in input) patch.threshold = input.threshold
  if ('isActive' in input) patch.isActive = input.isActive

  const updated = await updateAlert(id, auth.user.id, patch)

  // Non-owner and missing ids are both 404: a 403 would confirm existence.
  if (!updated) {
    return apiError(404, 'NOT_FOUND', 'Alert rule not found')
  }

  return NextResponse.json({ data: updated })
}

export async function DELETE(_request: Request, context: RouteContext) {
  // "owner or ADMIN" (`API.md`), and the role table gives MEMBER "manage own
  // alerts". The handler below stays scoped to `auth.user.id`, so the elevated
  // role cannot reach another account's rules — that is what keeps F-34's
  // cross-user isolation intact rather than the role list.
  const auth = await requireAuth(['ADMIN', 'MEMBER'])
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params

  // Scoped to the caller's own rules: another user's id simply is not found.
  const removed = await deleteAlert(id, auth.user.id)
  if (!removed) {
    return apiError(404, 'NOT_FOUND', 'Alert rule not found')
  }

  return NextResponse.json({ data: { success: true } })
}
