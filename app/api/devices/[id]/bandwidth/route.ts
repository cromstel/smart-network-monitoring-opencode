import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/api/auth'
import { getDeviceById } from '@/lib/services/deviceService'
import { listForDeviceBetween } from '@/lib/db/repositories/bandwidthRepository'

interface RouteContext {
  params: Promise<{ id: string }>
}

const querySchema = z.object({
  hours: z.coerce.number().int().positive().max(24 * 30).default(24),
})

/**
 * Bandwidth history for one device, PRD F-22.
 *
 * This route did not exist. lib/hooks/useDevices.ts has always fetched
 * /api/devices/:id/bandwidth, so the request 404'd, the chart stayed in its
 * empty state, and the 1h/24h/7d/30d range control could not be exercised —
 * a PRD §7 requirement that no test could have caught while the browser suite
 * was dead.
 *
 * The response is a bare array, which is the shape useDeviceBandwidth expects.
 * Byte counters stay strings for the same reason as everywhere else: they
 * exceed Number.MAX_SAFE_INTEGER and JSON.stringify throws on a bigint.
 */
export async function GET(request: Request, context: RouteContext) {
  const authResult = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { id } = await context.params

  const url = new URL(request.url)
  const parsed = querySchema.safeParse({ hours: url.searchParams.get('hours') ?? undefined })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_QUERY', message: 'hours must be a positive integer of at most 720' },
      { status: 400 }
    )
  }

  const device = await getDeviceById(id)
  if (!device) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'Device not found.' }, { status: 404 })
  }

  const to = new Date()
  const from = new Date(to.getTime() - parsed.data.hours * 60 * 60 * 1000)
  const metrics = await listForDeviceBetween(id, from, to)

  return NextResponse.json(
    metrics.map((m) => ({
      timestamp: m.timestamp.toISOString(),
      upload_speed: m.uploadSpeed,
      download_speed: m.downloadSpeed,
      // Strings by contract, see the note above.
      upload_total: m.uploadTotal,
      download_total: m.downloadTotal,
    }))
  )
}
