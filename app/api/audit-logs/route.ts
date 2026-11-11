import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { listAuditLogs, countAuditLogs } from '@/lib/services/auditLogService'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId') || undefined
  const action = searchParams.get('action') || undefined
  const resourceType = searchParams.get('resourceType') || undefined
  const resourceId = searchParams.get('resourceId') || undefined
  const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50
  const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : 0

  const [logs, total] = await Promise.all([
    listAuditLogs({ userId, action, resourceType, resourceId, limit, offset }),
    countAuditLogs({ userId, action, resourceType }),
  ])

  return NextResponse.json({
    data: logs,
    meta: {
      total,
      limit,
      offset,
    },
  })
}
