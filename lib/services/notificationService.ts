import { createVulnerabilityAlert } from '@/lib/db/repositories/vulnerabilityAlertRepository'
import { eventBusInstance, type VulnerabilityRaisedEvent } from '@/lib/services/eventBus'
import { logger } from '@/lib/utils/logger'

/**
 * Vulnerability intake.
 *
 * This used to email one hard-coded address (`admin@network.local`) and check
 * the caller's per-user notification toggle — a write-only defect of the same
 * family the rest of the notification code documents: the "admin" it notified
 * was really just whoever was passed in, and an install with three admins
 * reached one of them.
 *
 * Now the route-facing function records the vulnerability row (the durable
 * audit trail) and emits `vulnerability.raised`. The admin-group fan-out
 * subscriber in `adminNotifier.ts` resolves *every* active admin and handles
 * both channels, so this module no longer touches email at all.
 *
 * A previous `notifyUnknownDevice` export lived here with zero callers — an
 * "unknown device" alert is `alertService.evaluateUnknownDevice`'s job, and it
 * emits `alert.fanout`. It was removed rather than wired up, to keep one path
 * per concern.
 */
export async function notifyVulnerability(
  userId: string,
  deviceId: string | null,
  vulnerabilityType: string,
  severity: string,
  detail: string
): Promise<void> {
  await createVulnerabilityAlert(userId, deviceId, vulnerabilityType, severity, detail)

  const event: VulnerabilityRaisedEvent = {
    type: 'vulnerability.raised',
    timestamp: new Date().toISOString(),
    payload: {
      deviceId,
      vulnerabilityType,
      severity,
      detail,
      actorUserId: userId,
    },
  }

  try {
    eventBusInstance.emit(event)
  } catch (err) {
    // The row is already written; an emit failure must not turn a successful
    // record into a 500 for the admin who filed it.
    logger.error({ err, vulnerabilityType }, 'failed to emit vulnerability.raised event')
  }
}
