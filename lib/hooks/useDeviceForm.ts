'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import type { DeviceType } from '@/lib/types'
import type { DeviceDTO } from '@/lib/api/serialisers'

export function useDeviceForm(device: DeviceDTO | null | undefined) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState<{ deviceName: string | null; deviceType: DeviceType }>({
    deviceName: '',
    deviceType: 'unknown',
  })

  useEffect(() => {
    if (device) {
      setFormData({
        deviceName: device.deviceName,
        deviceType: device.deviceType,
      })
    }
  }, [device])

  const openEditDialog = useCallback(() => {
    setIsEditing(true)
  }, [])

  const closeEditDialog = useCallback(() => {
    setIsEditing(false)
    if (device) {
      setFormData({
        deviceName: device.deviceName,
        deviceType: device.deviceType,
      })
    }
  }, [device])

  /**
   * Bridges Radix's onOpenChange(next: boolean) onto the pair of callbacks.
   * Passing closeEditDialog directly ignored the argument, so the dialog's own
   * open request was immediately answered with isEditing=false and the Edit
   * button did nothing at all.
   */
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        openEditDialog()
      } else {
        closeEditDialog()
      }
    },
    [openEditDialog, closeEditDialog]
  )

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement> | React.ChangeEvent<HTMLSelectElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }))
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!device) return

    try {
      const response = await fetch(`/api/devices/${device.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        throw new Error('Failed to update device')
      }

      closeEditDialog()
      // router.refresh() re-renders server components, which does nothing for
      // data fetched client-side: useDeviceById serves from the react-query
      // cache with a five-minute staleTime, so the old name stayed on screen
      // until the cache happened to expire. Invalidate instead. The ['devices']
      // prefix covers both the detail key and the list key.
      await queryClient.invalidateQueries({ queryKey: ['devices'] })
      router.refresh()
    } catch (error) {
      console.error('Failed to update device:', error)
      alert('Failed to update device')
    }
  }, [device, formData, closeEditDialog, queryClient, router])

  return {
    handleOpenChange,
    isEditing,
    formData,
    setFormData,
    handleChange,
    handleSubmit,
    openEditDialog,
    closeEditDialog,
  }
}