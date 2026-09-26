import { logger } from '@/lib/utils/logger'

export type EventType =
  | 'device.connected'
  | 'device.disconnected'
  | 'bandwidth.tick'
  | 'alert.raised'

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

export type AppEvent =
  | DeviceConnectedEvent
  | DeviceDisconnectedEvent
  | BandwidthTickEvent
  | AlertRaisedEvent

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

    clear(): void {
      handlers.clear()
    },
  }
}

export const eventBusInstance = eventBus()