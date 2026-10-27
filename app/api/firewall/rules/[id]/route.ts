import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/errors'
import { deleteRule, setRuleActive } from '@/lib/services/firewallService'

export const dynamic = 'force-dynamic'

const toggleSchema = z.object({
  isActive: z.boolean(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Deleting a rule is reversible-ish (recreate it), but toggling the firewall
  // is not something a VIEWER should be able to do by design: ADMIN only,
  // matching the create route and the pre-existing block route this replaces.
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError(400, 'INVALID_BODY', 'Invalid JSON body')
  }

  const parsed = toggleSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'Invalid toggle', parsed.error.flatten())
  }

  const rule = await setRuleActive(id, parsed.data.isActive)
  if (!rule) {
    return apiError(404, 'NOT_FOUND', 'Block rule not found')
  }

  return NextResponse.json({ data: rule })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const deleted = await deleteRule(id)
  if (!deleted) {
    return apiError(404, 'NOT_FOUND', 'Block rule not found')
  }

  return NextResponse.json({ success: true })
}
