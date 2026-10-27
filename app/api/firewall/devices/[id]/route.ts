import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/errors'
import { setDeviceBlocked } from '@/lib/services/firewallService'

export const dynamic = 'force-dynamic'

const blockSchema = z.object({
  isBlocked: z.boolean(),
})

/**
 * The device-level half of the firewall: `devices.is_blocked`.
 *
 * A PATCH rather than a pair of block/unblock verbs — the body states the
 * target state, the same way the settings route works, so the client never has
 * to know which endpoint means which direction.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError(400, 'INVALID_BODY', 'Invalid JSON body')
  }

  const parsed = blockSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'Invalid block state', parsed.error.flatten())
  }

  const device = await setDeviceBlocked(id, parsed.data.isBlocked)
  if (!device) {
    return apiError(404, 'NOT_FOUND', 'Device not found')
  }

  return NextResponse.json({
    data: {
      id: device.id,
      macAddress: device.macAddress,
      deviceName: device.deviceName,
      hostname: device.hostname,
      isBlocked: device.isBlocked,
    },
  })
}
