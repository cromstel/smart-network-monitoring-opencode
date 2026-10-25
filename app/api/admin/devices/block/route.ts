import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { createBlock } from '@/lib/db/repositories/deviceBlockRepository'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  const user = auth.user
  const body = await req.json().catch(() => ({}))
  const { deviceId, websiteApp } = body || {}
  if (!deviceId || !websiteApp) {
    return NextResponse.json({ error: 'deviceId and websiteApp required' }, { status: 400 })
  }

  const result = await createBlock({ deviceId, websiteApp, createdBy: user.id })
  return NextResponse.json({ success: true, data: result })
}
