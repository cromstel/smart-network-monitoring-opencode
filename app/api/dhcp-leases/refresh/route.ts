import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { refreshLeasesFromScan } from '@/lib/services/dhcpLeaseService'

export const dynamic = 'force-dynamic'

export async function POST() {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  const result = await refreshLeasesFromScan()
  return NextResponse.json({ data: result })
}
