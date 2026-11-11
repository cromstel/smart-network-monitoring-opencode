import * as auditLogRepo from '@/lib/db/repositories/auditLogRepository'
import type { AuditLog } from '@/lib/db/repositories/auditLogRepository'
import { logger } from '@/lib/utils/logger'

/**
 * Audit log service — records administrative actions for security and
 * accountability. All writes are fire-and-forget: an audit log failure must
 * never prevent the underlying action from completing.
 */

export async function recordAuditLog(input: {
  userId: string
  action: string
  resourceType: string
  resourceId?: string | null
  oldValues?: string | null
  newValues?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}): Promise<void> {
  try {
    await auditLogRepo.createAuditLog(input)
  } catch (err) {
    // Audit logging must never break the primary operation.
    logger.error({ err, action: input.action, resourceType: input.resourceType }, 'failed to write audit log')
  }
}

export async function listAuditLogs(options?: {
  userId?: string
  action?: string
  resourceType?: string
  resourceId?: string
  limit?: number
  offset?: number
}): Promise<AuditLog[]> {
  return auditLogRepo.listAuditLogs(options)
}

export async function countAuditLogs(options?: {
  userId?: string
  action?: string
  resourceType?: string
}): Promise<number> {
  return auditLogRepo.countAuditLogs(options)
}
