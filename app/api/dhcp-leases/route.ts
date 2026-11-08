import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { listActiveLeases } from '@/lib/services/dhcpLeaseService'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  const leases = await listActiveLeases()
  return NextResponse.json({ data: leases })
}
