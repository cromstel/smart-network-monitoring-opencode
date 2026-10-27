import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/errors'
import { FirewallError, createRule, listRules } from '@/lib/services/firewallService'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  deviceId: z.string().min(1),
  websiteApp: z.string().min(1).max(255),
})

export async function GET() {
  // Read is view-only: every signed-in role can see the firewall state, the
  // same way every role can see the device list. Mutations below are
  // ADMIN-only, and the UI hides them from other roles — but the check that
  // counts is this one (PRD F-62: "and", not "or").
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  const rules = await listRules()
  return NextResponse.json({ data: rules })
}

export async function POST(request: Request) {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError(400, 'INVALID_BODY', 'Invalid JSON body')
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'Invalid block rule', parsed.error.flatten())
  }

  try {
    const rule = await createRule({
      deviceId: parsed.data.deviceId,
      websiteApp: parsed.data.websiteApp,
      userId: auth.user.id,
    })
    return NextResponse.json({ data: rule }, { status: 201 })
  } catch (error) {
    // The service raises typed errors whose codes already exist in
    // `lib/api/errors.ts`; anything else is a real failure and surfaces as a
    // 500 with its message logged rather than swallowed.
    if (error instanceof FirewallError) {
      const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : 400
      return apiError(status, error.code, error.message)
    }
    throw error
  }
}
