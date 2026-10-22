'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useDeviceById, useDeviceBandwidth, useDeviceConnectionLogs } from '@/lib/hooks/useDevices'
import { useDeviceForm } from '@/lib/hooks/useDeviceForm'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@radix-ui/react-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@radix-ui/react-select'
import { Loader2, Save, X, Wifi, WifiOff, AlertTriangle, Edit2 } from 'lucide-react'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { cn } from '@/lib/utils/cn'
import type { EnrichedDevice, DeviceType, DeviceStatus } from '@/lib/types'

const RANGES = [
  { value: 1, label: '1 Hour' },
  { value: 24, label: '24 Hours' },
  { value: 168, label: '7 Days' },
  { value: 720, label: '30 Days' },
] as const

const DEVICE_TYPES: DeviceType[] = [
  'phone', 'tablet', 'laptop', 'desktop', 'tv', 'speaker',
  'printer', 'camera', 'server', 'switch', 'router', 'iot', 'unknown',
]

function formatBytes(bytes: string): string {
  const num = parseFloat(bytes)
  if (num >= 1e12) return `${(num / 1e12).toFixed(2)} TB`
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)} GB`
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)} MB`
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)} KB`
  return `${num.toFixed(2)} B`
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleString()
}

function formatDuration(seconds: number): string {
  if (seconds >= 86_400) return `${Math.round(seconds / 86_400)}d`
  if (seconds >= 3_600) return `${Math.round(seconds / 3_600)}h`
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`
  return `${seconds}s`
}

export default function DeviceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const deviceId = params.id as string

  const { data: device, isLoading: deviceLoading, isError: deviceIsError, error: deviceError } = useDeviceById(deviceId)
  const [range, setRange] = useState(24)
  const { data: bandwidth, isLoading: bandwidthLoading } = useDeviceBandwidth(deviceId, range)
  const { data: connectionLogs = [], isLoading: logsLoading } = useDeviceConnectionLogs(deviceId)

  const { isEditing, formData, setFormData, handleChange, handleSubmit, openEditDialog, closeEditDialog, handleOpenChange } = useDeviceForm(device)
  // Role only hides the affordance; the PATCH handler still re-checks the
  // session (PRD F-62). VIEWERs cannot rename devices.
  const { permissions } = useCurrentUser()

  if (deviceLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        <span className="ml-3 text-slate-400">Loading device...</span>
      </div>
    )
  }

  if (deviceIsError || !device) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-400">
        <AlertTriangle className="h-12 w-12 mb-4 text-red-400" />
        <p>Device not found</p>
        {deviceError && <p className="text-sm text-red-400 mt-2">Failed to load device</p>}
        <button
          onClick={() => router.push('/')}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
        >
          Back to Devices
        </button>
      </div>
    )
  }

  const chartData = bandwidth?.map((point) => ({
    timestamp: new Date(point.timestamp).toLocaleTimeString(),
    upload: point.upload_speed,
    download: point.download_speed,
  })) || []

  return (
    <section className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {device.deviceName || device.macAddress}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            MAC: {device.macAddress} Â· IP: {device.ipAddress}
            {device.hostname && ` Â· Hostname: ${device.hostname}`}
          </p>
        </div>
        <Dialog open={isEditing} onOpenChange={handleOpenChange}>
          {permissions.canManage && (
            <DialogTrigger asChild>
              <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 flex items-center gap-2">
                <Edit2 className="h-4 w-4" />
                Edit
              </button>
            </DialogTrigger>
          )}
          <DialogContent className="max-w-md">
            <div className="space-y-4">
              <DialogTitle>Edit Device</DialogTitle>
              <DialogDescription>
                Update the device name and type
              </DialogDescription>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="device-name" className="block text-sm font-medium text-slate-300 mb-1">Device Name</label>
                <input
                  id="device-name"
                  type="text"
                  name="deviceName"
                  value={formData.deviceName || ''}
                  onChange={handleChange}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label id="device-type-label" className="block text-sm font-medium text-slate-300 mb-1">Device Type</label>
                <Select value={formData.deviceType} onValueChange={(value) => setFormData((prev) => ({ ...prev, deviceType: value as DeviceType }))}>
                  <SelectTrigger aria-labelledby="device-type-label" className="w-full bg-slate-800 border border-slate-700">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEVICE_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={closeEditDialog} className="px-4 py-2 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 flex items-center gap-2">
                  <Save className="h-4 w-4" />
                  Save
                </button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-6">
          <h2 className="text-lg font-medium mb-4">Status</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Connection</span>
              <span className={cn(
                'inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium',
                device.status === 'online'
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-slate-700 text-slate-400'
              )}>
                {device.status === 'online' ? (
                  <>
                    <Wifi className="h-4 w-4" />
                    Online
                  </>
                ) : (
                  <>
                    <WifiOff className="h-4 w-4" />
                    Offline
                  </>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Manufacturer</span>
              <span className="text-slate-300 font-medium">
                {device.manufacturer || 'Unknown'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Type</span>
              <span className="inline-flex items-center rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-300">
                {device.deviceType}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Signal Strength</span>
              <span className="text-slate-300 font-medium">
                {device.signalStrength !== null
                  ? `${device.signalStrength} dBm`
                  : 'N/A'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">First Seen</span>
              <span className="text-slate-300 font-medium">
                {formatDate(device.firstSeen)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Last Seen</span>
              <span className="text-slate-300 font-medium">
                {formatDate(device.lastSeen)}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-6 lg:col-span-2">
          <h2 className="text-lg font-medium mb-4">Bandwidth Usage</h2>
          <div className="flex items-center gap-2 mb-4">
            <label className="text-sm text-slate-400">Time Range:</label>
            <Select value={range.toString()} onValueChange={(v) => setRange(Number(v))}>
              <SelectTrigger className="w-[160px] bg-slate-800/50 border border-slate-700">
                <SelectValue placeholder="24 Hours" />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r.value} value={r.value.toString()}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {bandwidthLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
            </div>
          ) : chartData.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p>No bandwidth data available for this period</p>
            </div>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis
                    dataKey="timestamp"
                    tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                    stroke="var(--chart-grid)"
                    tickCount={6}
                  />
                  <YAxis
                    tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                    stroke="var(--chart-grid)"
                    tickFormatter={(value) => `${value} Mbps`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--chart-tooltip-bg)',
                      border: '1px solid var(--chart-grid)',
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: 'var(--chart-tooltip-fg)' }}
                    itemStyle={{ color: 'var(--chart-tooltip-fg)' }}
                    formatter={(value: any) => [`${(value ?? 0).toFixed(2)} Mbps`, '']}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="download"
                    stroke="var(--chart-download)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 6 }}
                    name="Download"
                  />
                  <Line
                    type="monotone"
                    dataKey="upload"
                    stroke="var(--chart-upload)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 6 }}
                    name="Upload"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-6">
          <h2 className="text-lg font-medium mb-4">Total Traffic</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Total Downloaded</span>
              <span className="text-slate-300 font-medium font-mono">
                {formatBytes(device.totalTransferred.downloadBytes)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Total Uploaded</span>
              <span className="text-slate-300 font-medium font-mono">
                {formatBytes(device.totalTransferred.uploadBytes)}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-6">
          <h2 className="text-lg font-medium mb-4">Connection History</h2>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {logsLoading ? (
              <p className="text-slate-400 text-sm">Loading connection history...</p>
            ) : connectionLogs.length === 0 ? (
              <p className="text-slate-400 text-sm">No connection events recorded yet.</p>
            ) : (
              connectionLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between gap-4 text-sm">
                  <span
                    className={cn(
                      'font-medium',
                      log.eventType === 'connected' ? 'text-green-400' : 'text-amber-400'
                    )}
                  >
                    {log.eventType === 'connected' ? 'Connected' : 'Disconnected'}
                  </span>
                  {log.connectionDuration !== null && (
                    <span className="text-slate-500 font-mono text-xs">
                      lasted {formatDuration(log.connectionDuration)}
                    </span>
                  )}
                  <span className="text-slate-400">{formatDate(log.timestamp)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  )
}