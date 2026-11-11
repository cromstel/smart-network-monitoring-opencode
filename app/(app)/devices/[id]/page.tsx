'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useDeviceById, useDeviceBandwidth, useDeviceConnectionLogs } from '@/lib/hooks/useDevices'
import { useDeviceForm } from '@/lib/hooks/useDeviceForm'
import { useQuery } from '@tanstack/react-query'
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

interface DeviceNote {
  id: string
  deviceId: string
  userId: string
  note: string
  createdAt: string
  updatedAt: string
}

export default function DeviceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const deviceId = params.id as string

  const { data: device, isLoading: deviceLoading, isError: deviceIsError, error: deviceError } = useDeviceById(deviceId)
  const [range, setRange] = useState(24)
  const { data: bandwidth, isLoading: bandwidthLoading } = useDeviceBandwidth(deviceId, range)
  const { data: connectionLogs = [], isLoading: logsLoading } = useDeviceConnectionLogs(deviceId)

  const { data: peakPerDay, isLoading: peakLoading } = useQuery({
    queryKey: ['devices', deviceId, 'peak'],
    queryFn: async () => {
      const res = await fetch(`/api/devices/${deviceId}/peak?days=7`)
      if (!res.ok) throw new Error('Failed to load peak throughput')
      return (await res.json()) as { data: Array<{ date: string; peakUploadMbps: number; peakDownloadMbps: number }> }
    },
    enabled: !!deviceId,
    staleTime: 5 * 60 * 1000,
  })

  // Notes state
  const [notes, setNotes] = useState<DeviceNote[]>([])
  const [newNote, setNewNote] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editNote, setEditNote] = useState('')
  const [notesLoading, setNotesLoading] = useState(false)

  const { isEditing, formData, setFormData, handleChange, handleSubmit, openEditDialog, closeEditDialog, handleOpenChange } = useDeviceForm(device)
  const { permissions } = useCurrentUser()

  async function loadNotes() {
    setNotesLoading(true)
    try {
      const res = await fetch(`/api/devices/${deviceId}/notes`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load notes')
      const body = await res.json()
      setNotes(body.data || [])
    } catch (err) {
      console.error('Failed to load notes:', err)
    } finally {
      setNotesLoading(false)
    }
  }

  async function createNote(input: { deviceId: string; note: string }) {
    setAddingNote(true)
    try {
      const res = await fetch(`/api/devices/${deviceId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error('Failed to create note')
      const created = (await res.json()) as { data: DeviceNote }
      setNotes((prev) => [created.data, ...prev])
      setNewNote('')
    } finally {
      setAddingNote(false)
    }
  }

  async function updateNote(id: string, note: string) {
    try {
      const res = await fetch(`/api/devices/${deviceId}/notes?id=${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      if (!res.ok) throw new Error('Failed to update note')
      const updated = (await res.json()) as { data: DeviceNote }
      setNotes((prev) => prev.map((n) => (n.id === id ? updated.data : n)))
      setEditingNoteId(null)
      setEditNote('')
    } catch (err) {
      console.error('Failed to update note:', err)
    }
  }

  async function deleteNote(id: string) {
    try {
      const res = await fetch(`/api/devices/${deviceId}/notes?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete note')
      setNotes((prev) => prev.filter((n) => n.id !== id))
    } catch (err) {
      console.error('Failed to delete note:', err)
    }
  }

  useEffect(() => {
    loadNotes()
  }, [deviceId])

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
            {device.deviceName || device.hostname || device.macAddress}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            MAC: {device.macAddress} · IP: {device.ipAddress}
            {device.ipv6Address && ` · IPv6: ${device.ipv6Address}`}
            {device.hostname && ` · Hostname: ${device.hostname}`}
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
          <Link
            href="/devices"
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
          >
            ← Back to devices
          </Link>
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
                  : device.status === 'idle'
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-slate-700 text-slate-400'
              )}>
                {device.status === 'online' ? (
                  <>
                    <Wifi className="h-4 w-4" />
                    Online
                  </>
                ) : device.status === 'idle' ? (
                  <>
                    <AlertTriangle className="h-4 w-4" />
                    Idle
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
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Cumulative Connection</span>
              <span className="text-slate-300 font-medium">
                {formatDuration(device.totalConnectionTimeSeconds)}
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

      <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-6">
        <h2 className="text-lg font-medium mb-4">Peak Throughput (per day)</h2>
        {peakLoading ? (
          <p className="text-slate-400 text-sm">Loading peak throughput…</p>
        ) : (peakPerDay?.data ?? []).length === 0 ? (
          <p className="text-slate-400 text-sm">No peak data available yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="pb-2 text-slate-400">Date</th>
                  <th className="pb-2 text-slate-400 text-right">Peak Download (Mbps)</th>
                  <th className="pb-2 text-slate-400 text-right">Peak Upload (Mbps)</th>
                  <th className="pb-2 text-slate-400 text-right">Peak Total (Mbps)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {(peakPerDay?.data ?? []).map((day) => (
                  <tr key={day.date} className="hover:bg-slate-800/50">
                    <td className="py-3 text-slate-300 font-medium">{day.date}</td>
                    <td className="py-3 text-slate-200 font-mono text-right">
                      {day.peakDownloadMbps.toFixed(1)}
                    </td>
                    <td className="py-3 text-slate-200 font-mono text-right">
                      {day.peakUploadMbps.toFixed(1)}
                    </td>
                    <td className="py-3 text-slate-200 font-mono text-right">
                      {(day.peakDownloadMbps + day.peakUploadMbps).toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

      <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-6">
        <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
          <span className="text-blue-400">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.418-9a4.01 4.01 0 00-1.202 5.657L5.585 15.086a2 2 0 01-3.828 0l-2.829-2.829a2 2 0 010-2.828l8.486-8.485zM15 11l-3.286 3.286a2 2 0 01-2.828 0L6.95 13.828a2 2 0 010-2.828l8.486-8.485z" />
            </svg>
          </span>
          Notes
        </h2>
        <div className="space-y-3">
          {notes.length === 0 ? (
            <p className="text-sm text-slate-500">No notes yet. Add a note to record information about this device.</p>
          ) : (
            <div className="space-y-2">
              {notes.map((note) => (
                <div key={note.id} className="flex items-start justify-between gap-3 py-3 rounded-lg border border-slate-800/50 bg-slate-800/30">
                  <div className="flex-1">
                    <p className="text-sm text-slate-200">{note.note}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-500 font-medium">{note.createdAt}</span>
                      <span className="text-xs text-slate-500 font-medium">by {note.userId}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingNoteId(note.id)
                        setEditNote(note.note)
                      }}
                      className="text-xs text-slate-400 hover:text-blue-400 dark:hover:text-blue-300"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('Are you sure you want to delete this note?')) {
                          deleteNote(note.id)
                        }
                      }}
                      className="text-xs text-slate-400 hover:text-red-400 dark:hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="text-sm font-medium text-slate-300 mb-3">Add Note</h3>
            <form onSubmit={(e) => {
              e.preventDefault()
              if (!newNote.trim()) return
              createNote({ deviceId, note: newNote })
            }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Add a note about this device..."
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={!newNote.trim() || addingNote}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-slate-800 text-slate-300 disabled:opacity-50 disabled:pointer-events-none hover:bg-slate-700 hover:text-slate-100"
              >
                {addingNote ? 'Adding...' : 'Add'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  )
}