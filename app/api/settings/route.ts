import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/errors'
import { getUserSettings, saveUserSettings } from '@/lib/services/settingsService'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  scanIntervalSeconds: z.number().int().min(30).max(3600).optional(),
  dataRetentionDays: z.number().int().min(1).max(365).optional(),
  networkSubnet: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, 'Expected CIDR, e.g. 192.168.1.0/24').optional(),
  notifyNewDevices: z.boolean().optional(),
  notifyDeviceOffline: z.boolean().optional(),
  notifyHighBandwidth: z.boolean().optional(),
  bandwidthThreshold: z.number().nonnegative().max(100_000).optional(),
  theme: z.enum(['dark', 'light']).optional(),
})

export async function GET() {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  const settings = await getUserSettings(auth.user.id)
  return NextResponse.json({ data: settings })
}

export async function PATCH(request: Request) {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError(400, 'INVALID_BODY', 'Invalid JSON body')
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'Invalid settings', parsed.error.flatten())
  }

  const settings = await saveUserSettings(auth.user.id, parsed.data)
  return NextResponse.json({ data: settings })
}
