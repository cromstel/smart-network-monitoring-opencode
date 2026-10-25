import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { db } from '@/lib/db/client'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  try {
    const { id } = await params
    await db.deleteFrom('device_blocks').where('id', '=', id).execute()
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'delete failed' }, { status: 500 })
  }
}
