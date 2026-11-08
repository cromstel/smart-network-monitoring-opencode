import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { distinctCategories } from '@/lib/db/repositories/deviceRepository'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  const categories = await distinctCategories()
  return NextResponse.json({ data: categories })
}
