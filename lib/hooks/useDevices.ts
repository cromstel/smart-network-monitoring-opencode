'use client'

import { useQuery } from '@tanstack/react-query'
import type { EnrichedDevice, DeviceFilters, Pagination } from '@/lib/types'

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
      return response.json() as Promise<{
        data: EnrichedDevice[]
        pagination: Pagination
      }>
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
      return response.json() as Promise<EnrichedDevice | null>
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