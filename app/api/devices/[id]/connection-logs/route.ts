import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/api/auth'
import { getDeviceById } from '@/lib/services/deviceService'
import { listByDevice } from '@/lib/db/repositories/connectionLogRepository'

interface RouteContext {
  params: Promise<{ id: string }>
}

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
})

/**
 * Connection history for one device (PRD: "tracks its bandwidth and
 * connection history"). The table, the repository (`listByDevice`) and the
 * scanner all existed — only the endpoint was missing, so the device page
 * could only render its hardcoded "Connection history will be displayed
 * here" placeholder forever (found by an admin-session audit, 2026-10-15).
 *
 * Newest first, capped at 100. `connectionDuration` is seconds and is only
 * present on `disconnected` events.
 */
export async function GET(request: Request, context: RouteContext) {
  const authResult = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { id } = await context.params

  const url = new URL(request.url)
  const parsed = querySchema.safeParse({ limit: url.searchParams.get('limit') ?? undefined })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_QUERY', message: 'limit must be a positive integer of at most 100' },
      { status: 400 }
    )
  }

  const device = await getDeviceById(id)
  if (!device) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'Device not found.' }, { status: 404 })
  }

  const logs = await listByDevice(id, parsed.data.limit)

  return NextResponse.json(
    logs.map((log) => ({
      id: log.id,
      eventType: log.eventType,
      timestamp: log.timestamp.toISOString(),
      ipAddress: log.ipAddress,
      connectionDuration: log.connectionDuration,
    }))
  )
}
