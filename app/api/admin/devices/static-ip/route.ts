import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { db } from '@/lib/db/client'

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const { deviceId, staticIp } = body || {}
  if (!deviceId || !staticIp) {
    return NextResponse.json({ error: 'deviceId and staticIp required' }, { status: 400 })
  }

  await db.updateTable('devices').set({ static_ip: staticIp, updated_at: new Date().toISOString() }).where('id', '=', deviceId).execute()
  return NextResponse.json({ success: true, deviceId, staticIp })
}
