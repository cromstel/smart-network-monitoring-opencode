'use client'

import { useQuery } from '@tanstack/react-query'
import type { DeviceFilters, Pagination } from '@/lib/types'
import type { DeviceDTO } from '@/lib/api/serialisers'

interface UseDevicesOptions extends DeviceFilters {
  pagination?: Pagination
}

export function useDevices(options: UseDevicesOptions = {}) {
  const { page = 1, pageSize = 25, search, status, type, sort = 'lastSeen', order = 'desc' } = options

  return useQuery({
    queryKey: ['devices', { page, pageSize, search, status, type, sort, order }],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('page', page.toString())
      params.set('pageSize', pageSize.toString())
      if (search) params.set('search', search)
      if (status) params.set('status', status)
      if (type) params.set('type', type)
      params.set('sort', sort)
      params.set('order', order)

      const response = await fetch(`/api/devices?${params.toString()}`)
      if (!response.ok) {
        throw new Error('Failed to fetch devices')
      }
      // The API serialises through toDeviceDTO, which flattens the
      // EnrichedDevice aggregate. Consuming the domain shape here instead of
      // the DTO is what previously crashed the dashboard: the component read
      // device.device.lastSeen, `device.device` was undefined, and every page
      // render threw.
      const body = (await response.json()) as { data: DeviceDTO[]; pagination: Pagination }
      return body.data
    },
    staleTime: 5_000,
  })
}

export function useDeviceById(id: string | null) {
  return useQuery({
    queryKey: ['devices', id],
    queryFn: async () => {
      if (!id) return null
      const response = await fetch(`/api/devices/${id}`)
      if (!response.ok) {
        if (response.status === 404) return null
        throw new Error('Failed to fetch device')
      }
      const body = (await response.json()) as { data: DeviceDTO }
      return body.data
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  })
}

export function useDeviceBandwidth(deviceId: string | null, hours = 24) {
  return useQuery({
    queryKey: ['devices', deviceId, 'bandwidth', hours],
    queryFn: async () => {
      if (!deviceId) return null
      const response = await fetch(`/api/devices/${deviceId}/bandwidth?hours=${hours}`)
      if (!response.ok) {
        throw new Error('Failed to fetch bandwidth')
      }
      return response.json() as Promise<Array<{
        timestamp: string
        upload_speed: number
        download_speed: number
        upload_total: string
        download_total: string
      }>>
    },
    enabled: !!deviceId,
    staleTime: 5_000,
  })
}

export interface ConnectionLogDTO {
  id: string
  eventType: 'connected' | 'disconnected'
  timestamp: string
  ipAddress: string | null
  connectionDuration: number | null
}

export function useDeviceConnectionLogs(deviceId: string | null, limit = 20) {
  return useQuery({
    queryKey: ['devices', deviceId, 'connection-logs', limit],
    queryFn: async () => {
      if (!deviceId) return []
      const response = await fetch(`/api/devices/${deviceId}/connection-logs?limit=${limit}`)
      if (!response.ok) {
        throw new Error('Failed to fetch connection history')
      }
      return response.json() as Promise<ConnectionLogDTO[]>
    },
    enabled: !!deviceId,
    staleTime: 5_000,
  })
}