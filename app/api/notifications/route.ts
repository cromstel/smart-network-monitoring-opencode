import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { countUnread, getUserNotifications } from '@/lib/services/alertService'
import { listDevices } from '@/lib/services/deviceService'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const isReadParam = url.searchParams.get('isRead')
  const type = url.searchParams.get('type') ?? undefined

  const parsedPageSize = Number(url.searchParams.get('pageSize') ?? '50')
  const pageSize = Number.isFinite(parsedPageSize)
    ? Math.min(Math.max(Math.trunc(parsedPageSize), 1), 100)
    : 50

  // `isRead=false` → unread only; `isRead=true` → read only; absent → all.
  const unreadOnly = isReadParam === 'false' ? true : undefined
  const readOnly = isReadParam === 'true' ? true : undefined

  const [notifications, devices, unreadCount] = await Promise.all([
    getUserNotifications(auth.user.id, {
      unreadOnly,
      readOnly,
      limit: pageSize,
      type: type || undefined,
    }),
    listDevices({ page: 1, pageSize: 100 }),
    countUnread(auth.user.id),
  ])

  return NextResponse.json({
    data: {
      notifications,
      devices: devices.data.map((d) => ({
        id: d.device.id,
        name: d.device.deviceName ?? d.device.macAddress,
        macAddress: d.device.macAddress,
      })),
      unreadCount,
    },
  })
}


