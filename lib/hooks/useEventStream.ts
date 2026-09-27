'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { queryClient } from '@/lib/queryClient'

export interface DeviceConnectedPayload {
  deviceId: string
  macAddress: string
  ipAddress: string
  hostname?: string
}

export interface DeviceDisconnectedPayload {
  deviceId: string
  macAddress: string
  connectionDuration: number
}

export interface AlertRaisedPayload {
  alertId: string
  deviceId: string | null
  alertType: string
  message: string
  priority: string
}

interface EventHandlers {
  onDeviceConnected?: (payload: DeviceConnectedPayload) => void
  onDeviceDisconnected?: (payload: DeviceDisconnectedPayload) => void
  onAlertRaised?: (payload: AlertRaisedPayload) => void
}

const MAX_BACKOFF_MS = 30_000

/**
 * Subscribes to the server's SSE stream and turns events into TanStack Query
 * invalidations.
 *
 * The client never renders an event payload directly — an event only marks a
 * query stale and the normal fetch path refills it. That keeps one code path
 * for data whether it arrived by poll or by push (ARCHITECTURE.md §6).
 *
 * EventSource reconnects on its own, but a server restart during dev can leave
 * it in a closed state, so an explicit backoff reconnect is layered on top.
 */
export function useEventStream(handlers: EventHandlers = {}): {
  isConnected: boolean
  error: Error | null
} {
  const sourceRef = useRef<EventSource | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const handlersRef = useRef(handlers)

  handlersRef.current = handlers

  const connect = useCallback(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return

    sourceRef.current?.close()

    const source = new EventSource('/api/events')
    sourceRef.current = source

    source.onopen = () => {
      attemptsRef.current = 0
      setIsConnected(true)
      setError(null)
    }

    source.addEventListener('device.connected', (event) => {
      try {
        handlersRef.current.onDeviceConnected?.(JSON.parse((event as MessageEvent).data))
      } catch {
        /* a malformed frame must not kill the stream */
      }
      queryClient.invalidateQueries({ queryKey: ['devices'] })
    })

    source.addEventListener('device.disconnected', (event) => {
      try {
        handlersRef.current.onDeviceDisconnected?.(JSON.parse((event as MessageEvent).data))
      } catch {
        /* ignore */
      }
      queryClient.invalidateQueries({ queryKey: ['devices'] })
    })

    source.addEventListener('alert.raised', (event) => {
      try {
        handlersRef.current.onAlertRaised?.(JSON.parse((event as MessageEvent).data))
      } catch {
        /* ignore */
      }
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    })

    source.onerror = () => {
      setIsConnected(false)
      setError(new Error('Live updates reconnecting…'))

      const delay = Math.min(1000 * 2 ** attemptsRef.current, MAX_BACKOFF_MS)
      attemptsRef.current += 1

      if (retryRef.current) clearTimeout(retryRef.current)
      retryRef.current = setTimeout(connect, delay)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current)
      sourceRef.current?.close()
    }
  }, [connect])

  return { isConnected, error }
}
