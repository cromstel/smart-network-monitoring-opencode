import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/errors'
import { getUserNotifications, markNotificationRead } from '@/lib/services/alertService'
import { listDevices } from '@/lib/services/deviceService'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  const [notifications, devices] = await Promise.all([
    getUserNotifications(auth.user.id, { limit: 100 }),
    listDevices({ page: 1, pageSize: 100 }),
  ])

  return NextResponse.json({
    data: {
      notifications,
      devices: devices.data.map((d) => ({
        id: d.device.id,
        name: d.device.deviceName ?? d.device.macAddress,
        macAddress: d.device.macAddress,
      })),
    },
  })
}

export async function PATCH(request: Request) {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  let body: { id?: string }
  try {
    body = await request.json()
  } catch {
    return apiError(400, 'INVALID_BODY', 'Invalid JSON body')
  }

  if (!body.id) {
    return apiError(400, 'INVALID_BODY', 'id is required')
  }

  await markNotificationRead(body.id, auth.user.id)
  return NextResponse.json({ data: { success: true } })
}
