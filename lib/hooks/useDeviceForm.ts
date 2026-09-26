'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { EnrichedDevice, DeviceType } from '@/lib/types'

export function useDeviceForm(device: EnrichedDevice | null | undefined) {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState<{ deviceName: string | null; deviceType: DeviceType }>({
    deviceName: '',
    deviceType: 'unknown',
  })

  useEffect(() => {
    if (device) {
      setFormData({
        deviceName: device.device.deviceName,
        deviceType: device.device.deviceType,
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
        deviceName: device.device.deviceName,
        deviceType: device.device.deviceType,
      })
    }
  }, [device])

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
      const response = await fetch(`/api/devices/${device.device.id}`, {
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
      router.refresh()
    } catch (error) {
      console.error('Failed to update device:', error)
      alert('Failed to update device')
    }
  }, [device, formData, closeEditDialog, router])

  return {
    isEditing,
    formData,
    setFormData,
    handleChange,
    handleSubmit,
    openEditDialog,
    closeEditDialog,
  }
}