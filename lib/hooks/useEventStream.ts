'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { queryClient } from '@/lib/queryClient'
import { logger } from '@/lib/utils/logger'

interface EventHandlers {
  onDeviceConnected?: (payload: { deviceId: string; macAddress: string; ipAddress: string; hostname?: string }) => void
  onDeviceDisconnected?: (payload: { deviceId: string; macAddress: string; connectionDuration: number }) => void
  onBandwidthTick?: (payload: { deviceId: string; uploadSpeed: number; downloadSpeed: number; timestamp: string }) => void
  onAlertRaised?: (payload: { alertId: string; deviceId: string | null; alertType: string; message: string; priority: string }) => void
}

export function useEventStream(handlers: EventHandlers = {}): { isConnected: boolean; error: Error | null } {
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const handlersRef = useRef(handlers)

  handlersRef.current = handlers

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const es = new EventSource('/api/events')
    eventSourceRef.current = es

    es.onopen = () => {
      setIsConnected(true)
      setError(null)
      reconnectAttemptsRef.current = 0
      logger.info('SSE connection established')
    }

    es.addEventListener('connected', () => {
      logger.debug('SSE connected event received')
    })

    es.addEventListener('device.connected', (event) => {
      try {
        const payload = JSON.parse(event.data)
        handlersRef.current.onDeviceConnected?.(payload)
        queryClient.invalidateQueries({ queryKey: ['devices'] })
      } catch (e) {
        logger.error({ e }, 'Failed to parse device.connected event')
      }
    })

    es.addEventListener('device.disconnected', (event) => {
      try {
        const payload = JSON.parse(event.data)
        handlersRef.current.onDeviceDisconnected?.(payload)
        queryClient.invalidateQueries({ queryKey: ['devices'] })
      } catch (e) {
        logger.error({ e }, 'Failed to parse device.disconnected event')
      }
    })

    es.addEventListener('bandwidth.tick', (event) => {
      try {
        const payload = JSON.parse(event.data)
        handlersRef.current.onBandwidthTick?.(payload)
        queryClient.invalidateQueries({ queryKey: ['devices', 'bandwidth'] })
      } catch (e) {
        logger.error({ e }, 'Failed to parse bandwidth.tick event')
      }
    })

    es.addEventListener('alert.raised', (event) => {
      try {
        const payload = JSON.parse(event.data)
        handlersRef.current.onAlertRaised?.(payload)
        queryClient.invalidateQueries({ queryKey: ['alerts'] })
      } catch (e) {
        logger.error({ e }, 'Failed to parse alert.raised event')
      }
    })

    es.onerror = (err) => {
      setIsConnected(false)
      logger.warn({ err }, 'SSE connection error, scheduling reconnect')

      const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 30_000)
      reconnectAttemptsRef.current += 1

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }

      reconnectTimeoutRef.current = setTimeout(() => {
        connect()
      }, delay)

      setError(new Error('SSE connection lost, reconnecting...'))
    }
  }, [])

  useEffect(() => {
    connect()

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [connect])

  return { isConnected, error }
}