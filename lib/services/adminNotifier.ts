import * as alertRepo from '@/lib/db/repositories/alertRepository'
import { findActiveAdmins } from '@/lib/db/repositories/userRepository'
import { sendEmail } from './emailService'
import { eventBusInstance } from './eventBus'
import { logger } from '@/lib/utils/logger'
import type {
  AlertFanoutEvent,
  AppEvent,
  FirewallBlockedEvent,
  ScanCompletedEvent,
  SettingsChangedEvent,
  VulnerabilityRaisedEvent,
} from './eventBus'
import type { Notification, NotificationPriority, NotificationType } from '@/lib/types'

/**
 * Admin-group notification fan-out.
 *
 * When something worth an admin's attention happens — an alert fires, a
 * firewall block lands, a vulnerability is recorded, a scan breaks, settings
 * move — the whole active-admin group is told, through two channels: an
 * in-app `notifications` row and an email.
 *
 * ## Why the email failure is swallowed
 *
 * `sendEmail` throws when no provider is configured (`No email provider
 * configured`) or when SMTP is down. Neither is a reason to fail the caller:
 * the caller is a firewall route, the scan job, or the scheduler — an email
 * outage must not block a user from blocking a device. So each admin's email
 * is wrapped in its own try/catch: a missing provider degrades the whole
 * group to in-app-only, and one admin's bounce does not stop the next
 * admin's mail. The in-app row is written *first*, so it survives any email
 * problem.
 *
 * This is the same write-only-defect class the rest of the notification code
 * guards against, in reverse: before this module, an "admin notification"
 * was one hard-coded address, and an install with three admins silently
 * notified one of them.
 */

export interface AdminNotificationInput {
  title: string
  message: string
  type: NotificationType
  priority: NotificationPriority
  deviceId?: string | null
  /** Users who already got their per-user notification for this event. */
  excludeUserIds?: string[]
}

/**
 * Fans one notification out to every active admin.
 *
 * Never throws: a failure to resolve the group or write a row is logged and
 * results in zero-or-partial delivery, because every caller is on a path that
 * must not fail on notification trouble (a firewall route, the scan job, the
 * settings route). Returns the notifications actually created so a test can
 * assert delivery without re-querying.
 */
export async function notifyAdminGroup(
  input: AdminNotificationInput
): Promise<Notification[]> {
  const excluded = new Set(input.excludeUserIds ?? [])

  let admins: Array<{ id: string; email: string }>
  try {
    admins = await findActiveAdmins()
  } catch (err) {
    logger.error({ err, title: input.title }, 'admin fan-out could not resolve the admin group')
    return []
  }

  const recipients = admins.filter((admin) => !excluded.has(admin.id))
  if (recipients.length === 0) {
    logger.debug({ title: input.title }, 'admin fan-out: no recipients')
    return []
  }

  const created: Notification[] = []

  for (const admin of recipients) {
    // In-app row first: it is the durable record and must survive an email
    // outage. One row per admin so the per-user unread count and read-all
    // endpoints keep working unchanged.
    try {
      const notification = await alertRepo.createNotification({
        userId: admin.id,
        deviceId: input.deviceId ?? null,
        alertId: null,
        title: input.title,
        message: input.message,
        type: input.type,
        priority: input.priority,
      })
      created.push(notification)
    } catch (err) {
      logger.error(
        { err, adminId: admin.id, title: input.title },
        'admin fan-out failed to write in-app notification'
      )
      // Still try the email below: the row failing does not mean the mail
      // cannot go out, and the two channels are independent.
    }

    try {
      await sendEmail({
        to: admin.email,
        subject: `[Network Monitor] ${input.title}`,
        html: buildEmailHtml(input.title, input.message, input.priority),
        text: `${input.title}\n\n${input.message}`,
      })
    } catch (err) {
      // Expected on an install with no SMTP provider configured; logged at
      // error because a *configured* provider failing is worth an operator's
      // attention, and the in-app row above is the fallback.
      logger.error(
        { err, adminId: admin.id, title: input.title },
        'admin fan-out email failed (in-app notification still written)'
      )
    }
  }

  logger.info(
    { title: input.title, recipients: recipients.length, excluded: excluded.size },
    'admin fan-out delivered'
  )
  return created
}

/** Plain, dependency-free HTML — matches the style used by the older notify paths. */
function buildEmailHtml(title: string, message: string, priority: NotificationPriority): string {
  return `<h2>${escapeHtml(title)}</h2>
<p>${escapeHtml(message)}</p>
<p><strong>Priority:</strong> ${escapeHtml(priority)}</p>`
}

/** Minimal escaping: these strings include device hostnames and user input. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------------
// Event → notification mapping
// ---------------------------------------------------------------------------

interface MappedNotification {
  title: string
  message: string
  type: NotificationType
  priority: NotificationPriority
  deviceId?: string | null
  excludeUserIds?: string[]
}

function mapAlertFanout(event: AlertFanoutEvent): MappedNotification {
  const { alertType, deviceId, title, message, priority, excludeUserIds } = event.payload
  return {
    title,
    message,
    // `alertType` is one of the alert types, which are valid notification
    // types, so the row lands in the same bucket as the owner's own alert.
    type: alertType as NotificationType,
    priority,
    deviceId,
    excludeUserIds,
  }
}

function mapFirewallBlocked(event: FirewallBlockedEvent): MappedNotification {
  const { deviceLabel, action, target, actorUserId } = event.payload
  const title = action === 'device_blocked' ? 'Device blocked from the network' : 'Destination blocked'
  const message =
    action === 'device_blocked'
      ? `${deviceLabel} was blocked from the network by an administrator.`
      : `${target} was blocked for ${deviceLabel} by an administrator.`
  return {
    title,
    message,
    type: 'warning',
    priority: 'high',
    deviceId: event.payload.deviceId,
    // The admin who did it does not need telling about their own click.
    excludeUserIds: [actorUserId],
  }
}

function mapVulnerabilityRaised(event: VulnerabilityRaisedEvent): MappedNotification {
  const { vulnerabilityType, severity, detail, deviceId, actorUserId } = event.payload
  const high = severity === 'critical' || severity === 'high'
  return {
    title: `Vulnerability detected — ${vulnerabilityType}`,
    message: detail,
    type: high ? 'error' : 'warning',
    priority: severityToPriority(severity),
    deviceId,
    excludeUserIds: [actorUserId],
  }
}

function mapScanCompleted(event: ScanCompletedEvent): MappedNotification {
  const { status, scanner, errors, devicesFound, durationMs, errorMessage } = event.payload
  if (status === 'failed') {
    return {
      title: 'Network scan failed',
      message: `The ${scanner} scan did not complete: ${errorMessage ?? 'unknown error'}. No devices were updated.`,
      type: 'error',
      priority: 'high',
    }
  }
  return {
    title: 'Network scan partially completed',
    message: `${errors} device(s) failed to ingest during the ${scanner} scan (${devicesFound} found, ${durationMs}ms). Some devices may be missing or stale.`,
    type: 'warning',
    priority: 'medium',
  }
}

function mapSettingsChanged(event: SettingsChangedEvent): MappedNotification {
  const { changedKeys, actorUserId } = event.payload
  return {
    title: 'Settings changed',
    message: `An administrator updated: ${changedKeys.join(', ')}.`,
    type: 'info',
    priority: 'low',
    excludeUserIds: [actorUserId],
  }
}

/** Vulnerability severities arrive as free strings from the API route. */
function severityToPriority(severity: string): NotificationPriority {
  switch (severity.toLowerCase()) {
    case 'critical':
      return 'critical'
    case 'high':
      return 'high'
    case 'medium':
      return 'medium'
    default:
      return 'low'
  }
}

/** Maps an admin-group event to its notification, or null to ignore it. */
function mapEvent(event: AppEvent): MappedNotification | null {
  switch (event.type) {
    case 'alert.fanout':
      return mapAlertFanout(event)
    case 'firewall.blocked':
      return mapFirewallBlocked(event)
    case 'vulnerability.raised':
      return mapVulnerabilityRaised(event)
    case 'scan.completed':
      return mapScanCompleted(event)
    case 'settings.changed':
      return mapSettingsChanged(event)
    // Device/bandwidth traffic and per-rule `alert.raised` are live-dashboard
    // events, not admin notifications: a connected device or a bandwidth tick
    // would notify the group every scan cycle.
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Subscriber installation
// ---------------------------------------------------------------------------

const globalStore = globalThis as unknown as { __adminNotifier?: boolean }

/**
 * Subscribes the admin-group notifier to the event bus, once per process.
 *
 * The bus `emit` is synchronous and iterates handlers inline, so the handler
 * must not block it: the async fan-out is kicked off with `void` and its
 * errors are caught inside `notifyAdminGroup` (which never throws) plus a
 * defensive catch here for anything before it starts.
 *
 * The `globalThis` guard mirrors `instrumentation.node.ts`: `next dev` and
 * hot reload re-evaluate modules, and without the guard every reload would
 * stack another subscriber, sending N copies of each notification after N
 * reloads.
 *
 * Returns the unsubscribe function; a duplicate install is a no-op that
 * returns an already-detached unsubscribe.
 */
export function installAdminNotifier(): () => void {
  if (globalStore.__adminNotifier) {
    return () => undefined
  }
  globalStore.__adminNotifier = true

  const unsubscribe = eventBusInstance.on((event) => {
    const mapped = mapEvent(event)
    if (!mapped) return

    void notifyAdminGroup(mapped).catch((err) => {
      // notifyAdminGroup is written not to throw; this is belt-and-braces for
      // a future edit that adds a throwing statement above its guards.
      logger.error({ err, event: event.type }, 'admin fan-out rejected unexpectedly')
    })
  })

  logger.info('admin-group notifier subscribed to the event bus')

  return () => {
    unsubscribe()
    globalStore.__adminNotifier = false
  }
}
