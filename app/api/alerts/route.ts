import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/errors'
import { getUserAlerts, createAlert } from '@/lib/services/alertService'
import { KNOWN_ALERT_TYPES } from '@/lib/types'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  deviceId: z.string().uuid().nullable().optional(),
  alertType: z.enum(KNOWN_ALERT_TYPES),
  threshold: z.number().nonnegative().max(100_000).optional(),
})

export async function GET() {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  const alerts = await getUserAlerts(auth.user.id)
  return NextResponse.json({ data: alerts })
}

export async function POST(request: Request) {
  const auth = await requireAuth(['ADMIN', 'MEMBER'])
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError(400, 'INVALID_BODY', 'Invalid JSON body')
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'Invalid alert rule', parsed.error.flatten())
  }

  // A threshold only means something for the bandwidth rule.
  if (parsed.data.alertType !== 'bandwidth_exceeded' && parsed.data.threshold != null) {
    return apiError(400, 'INVALID_BODY', 'Only bandwidth_exceeded accepts a threshold')
  }

  // …and without one the rule could never fire, so it is required rather than
  // stored as null. `API.md`: "threshold is required for bandwidth_exceeded".
  if (parsed.data.alertType === 'bandwidth_exceeded' && parsed.data.threshold == null) {
    return apiError(400, 'INVALID_BODY', 'bandwidth_exceeded requires a threshold')
  }

  const alert = await createAlert({
    userId: auth.user.id,
    deviceId: parsed.data.deviceId ?? null,
    alertType: parsed.data.alertType,
    threshold: parsed.data.threshold,
  })

  return NextResponse.json({ data: alert }, { status: 201 })
}
