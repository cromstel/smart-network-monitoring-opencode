import { NextResponse } from 'next/server'
import { fetchNetworkTotals, fetchTodayPeak, fetchTopConsumers } from '@/lib/services/deviceService'
import { requireAuth } from '@/lib/api/auth'

export async function GET() {
  const authResult = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])

  if (authResult instanceof NextResponse) {
    return authResult
  }

  const [totals, peak, topConsumers] = await Promise.all([
    fetchNetworkTotals(),
    fetchTodayPeak(),
    fetchTopConsumers(5),
  ])

  return NextResponse.json({
    data: {
      totals,
      peak,
      topConsumers,
    },
  })
}