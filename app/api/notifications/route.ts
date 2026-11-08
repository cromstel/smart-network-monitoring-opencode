import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { getUserNotifications } from '@/lib/services/alertService'
import { listDevices } from '@/lib/services/deviceService'

export const dynamic = 'force-dynamic'

interface NotificationItem {
  id: string
  title: string
  message: string
  type: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  isRead: boolean
  createdAt: string
}

interface DeviceItem {
  id: string
  name: string
}

/**
 * F-33 / F-34: owner-scoped activity log.
 *
 * Returns `{ data: { notifications, devices } }` — the shape consumed by
 * `app/(app)/alerts/page.tsx` (Activity panel + rule device pickers) and by
 * `app/(app)/notifications/page.tsx`. Replaces the hardcoded demo stub that
 * made Activity always render empty and blocked bandwidth-rule creation.
 */
export async function GET() {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  const userId = auth.user.id

  // Independent fetches run in parallel.
  const [notifications, devices] = await Promise.all([
    getUserNotifications(userId, { limit: 50 }),
    listDevices().then((result) => result.data),
  ])

  return NextResponse.json({
    success: true,
    data: {
      notifications: notifications.map((n): NotificationItem => ({
        id: n.id,
        title: n.title,
        message: n.message,
        type: n.type,
        priority: n.priority,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
      })),
      devices: devices.map((d): DeviceItem => ({
        id: d.device.id,
        name: d.device.deviceName ?? d.device.hostname ?? 'Unknown device',
      })),
    },
  })
}
