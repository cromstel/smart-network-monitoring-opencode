import { logger } from '@/lib/utils/logger'

export type EventType =
  | 'device.connected'
  | 'device.disconnected'
  | 'bandwidth.tick'
  | 'alert.raised'
  // Admin-group notification fan-out events. See `adminNotifier.ts` for the
  // subscriber that turns these into per-admin notifications + emails.
  | 'alert.fanout'
  | 'firewall.blocked'
  | 'vulnerability.raised'
  | 'scan.completed'
  | 'settings.changed'

export interface BaseEvent {
  type: EventType
  timestamp: string
  userId?: string
}

export interface DeviceConnectedEvent extends BaseEvent {
  type: 'device.connected'
  payload: {
    deviceId: string
    macAddress: string
    ipAddress: string
    hostname?: string
  }
}

export interface DeviceDisconnectedEvent extends BaseEvent {
  type: 'device.disconnected'
  payload: {
    deviceId: string
    macAddress: string
    connectionDuration: number
  }
}

export interface BandwidthTickEvent extends BaseEvent {
  type: 'bandwidth.tick'
  payload: {
    deviceId: string
    uploadSpeed: number
    downloadSpeed: number
    timestamp: string
  }
}

export interface AlertRaisedEvent extends BaseEvent {
  type: 'alert.raised'
  payload: {
    alertId: string
    deviceId: string | null
    alertType: string
    message: string
    priority: 'low' | 'medium' | 'high' | 'critical'
  }
}

/**
 * "Some alert(s) fired for rule owners; now tell the rest of the admin group."
 *
 * Emitted once per evaluation pass in `alertService` (not once per rule), with
 * the rule owners who already received their per-user notification in
 * `excludeUserIds`. The fan-out subscriber must skip those users, or an admin
 * who owns a rule would be notified twice for the same event.
 */
export interface AlertFanoutEvent extends BaseEvent {
  type: 'alert.fanout'
  payload: {
    alertType: string
    deviceId: string | null
    title: string
    message: string
    priority: 'low' | 'medium' | 'high' | 'critical'
    excludeUserIds: string[]
  }
}

/** A firewall action: whole-device block, or one destination rule created. */
export interface FirewallBlockedEvent extends BaseEvent {
  type: 'firewall.blocked'
  payload: {
    deviceId: string
    deviceLabel: string
    action: 'device_blocked' | 'rule_created'
    /** Present only for `rule_created` — the blocked site/app hostname. */
    target?: string
    actorUserId: string
  }
}

/** A vulnerability was recorded (route-triggered), for admin-group awareness. */
export interface VulnerabilityRaisedEvent extends BaseEvent {
  type: 'vulnerability.raised'
  payload: {
    deviceId: string | null
    vulnerabilityType: string
    severity: string
    detail: string
    actorUserId: string
  }
}

/**
 * A scan finished in a degraded state. Successful scans deliberately do *not*
 * emit this: the scan runs on a short cron interval, so a success event would
 * notify the admin group every minute. Only partial (some devices failed to
 * ingest) and failed (the scanner itself threw) runs are worth a notification.
 */
export interface ScanCompletedEvent extends BaseEvent {
  type: 'scan.completed'
  payload: {
    status: 'partial' | 'failed'
    scanner: string
    errors: number
    devicesFound: number
    durationMs: number
    errorMessage: string | null
  }
}

/** Settings were saved. `changedKeys` lists exactly which fields moved. */
export interface SettingsChangedEvent extends BaseEvent {
  type: 'settings.changed'
  payload: {
    changedKeys: string[]
    actorUserId: string
  }
}

export type AppEvent =
  | DeviceConnectedEvent
  | DeviceDisconnectedEvent
  | BandwidthTickEvent
  | AlertRaisedEvent
  | AlertFanoutEvent
  | FirewallBlockedEvent
  | VulnerabilityRaisedEvent
  | ScanCompletedEvent
  | SettingsChangedEvent

type EventHandler = (event: AppEvent) => void

const handlers = new Set<EventHandler>()

export function eventBus() {
  return {
    emit(event: AppEvent): void {
      logger.debug({ event: event.type, payload: event.payload }, 'Event emitted')
      for (const handler of handlers) {
        try {
          handler(event)
        } catch (error) {
          logger.error({ error, event: event.type }, 'Event handler failed')
        }
      }
    },

    on(handler: EventHandler): () => void {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },

    /**
     * Current subscriber count. Exists to make listener leaks observable:
     * a per-connection subscription that is never released grows this set for
     * the life of the process, and nothing else in the system would reveal it.
     */
    listenerCount(): number {
      return handlers.size
    },

    clear(): void {
      handlers.clear()
    },
  }
}

export const eventBusInstance = eventBus()