import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { peakPerDay } from '@/lib/db/repositories/bandwidthRepository'

export const dynamic = 'force-dynamic'

const querySchema = (() => {
  const z = require('zod')
  return z.object({
    days: z.coerce.number().int().min(1).max(90).default(7),
  })
})()

/**
 * F-23: peak throughput per calendar day for a device.
 *
 * Returns one entry per day over the requested window, each with the max
 * upload/download speed observed that day. Zeros for days with no samples.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({ days: searchParams.get('days') })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_QUERY', message: 'Invalid days parameter' },
      { status: 400 }
    )
  }

  const peak = await peakPerDay(id, parsed.data.days)
  return NextResponse.json({ data: peak })
}
