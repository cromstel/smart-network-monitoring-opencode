import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { markAllNotificationsRead } from '@/lib/services/alertService'

export const dynamic = 'force-dynamic'

export async function POST() {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  const updated = await markAllNotificationsRead(auth.user.id)
  return NextResponse.json({ data: { updated } })
}
