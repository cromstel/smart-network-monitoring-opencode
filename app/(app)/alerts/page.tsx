'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'

interface AlertRule {
  id: string
  deviceId: string | null
  alertType: 'unknown_device' | 'bandwidth_exceeded' | 'device_offline'
  threshold: number | null
  isActive: boolean
  lastTriggered: string | null
  triggerCount: number
}

interface ActivityItem {
  id: string
  title: string
  message: string
  type: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  isRead: boolean
  createdAt: string
}

interface DeviceOption {
  id: string
  name: string
}

const RULE_LABELS: Record<AlertRule['alertType'], string> = {
  unknown_device: 'Alert on any new device',
  bandwidth_exceeded: 'Alert when a device exceeds a bandwidth limit',
  device_offline: 'Alert when a device goes offline',
}

const PRIORITY_STYLES: Record<ActivityItem['priority'], string> = {
  low: 'bg-slate-800 text-slate-300',
  medium: 'bg-blue-500/15 text-blue-300',
  high: 'bg-amber-500/15 text-amber-300',
  critical: 'bg-red-500/15 text-red-300',
}

export default function AlertsPage() {
  const queryClient = useQueryClient()
  const [type, setType] = useState<AlertRule['alertType']>('unknown_device')
  const [deviceId, setDeviceId] = useState('')
  const [threshold, setThreshold] = useState('50')
  const [error, setError] = useState<string | null>(null)

  // Hides the rule form and delete affordances from VIEWERs. Until the role
  // arrives (or if `/api/auth/me` fails) the controls stay visible, because
  // the handlers re-check the session themselves — this only avoids offering a
  // control that would be refused (PRD F-62: "and", not "or").
  const { permissions } = useCurrentUser()

  const rules = useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      const res = await fetch('/api/alerts')
      if (!res.ok) throw new Error('Failed to load alert rules')
      return (await res.json()) as { data: AlertRule[] }
    },
  })

  const activity = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await fetch('/api/notifications')
      if (!res.ok) throw new Error('Failed to load activity')
      return (await res.json()) as { data: { notifications: ActivityItem[]; devices: DeviceOption[] } }
    },
  })

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['alerts'] })
    queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }, [queryClient])

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alertType: type,
          deviceId: deviceId || null,
          threshold: type === 'bandwidth_exceeded' ? Number(threshold) : undefined,
        }),
      })
      if (res.status === 403) throw new Error('Only admins and members can create rules')
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? 'Failed to create rule')
      }
    },
    onSuccess: () => {
      setError(null)
      refresh()
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create rule'),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/alerts/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error('Failed to delete rule')
    },
    onSuccess: refresh,
  })

  const acknowledge = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      })
      if (!res.ok && res.status !== 404) throw new Error('Failed to mark notification read')
    },
    onSuccess: refresh,
  })

  const markAllRead = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/notifications/read-all', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to mark all read')
    },
    onSuccess: refresh,
  })

  const devices = activity.data?.data.devices ?? []
  const notifications = activity.data?.data.notifications ?? []
  const unread = useMemo(() => notifications.filter((n) => !n.isRead).length, [notifications])

  return (
    <section className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Alerts</h1>
        <p className="mt-1 text-sm text-slate-400">
          Rules are private to your account. {unread > 0 && `${unread} unread.`}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-2">
          {permissions.canManage && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              New rule
            </h2>
            <div className="mt-4 space-y-3">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as AlertRule['alertType'])}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
              >
                {Object.entries(RULE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>

              {type === 'bandwidth_exceeded' && (
                <>
                  <select
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
                  >
                    <option value="">Pick a device…</option>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <label className="block text-sm text-slate-400">
                    Threshold (Mbps)
                    <input
                      type="number"
                      min={1}
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
                    />
                  </label>
                </>
              )}

              {type === 'device_offline' && (
                <select
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
                >
                  <option value="">Any device</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              )}

              {type === 'unknown_device' && (
                <p className="text-xs text-slate-500">
                  Fires once per device the first time it is seen.
                </p>
              )}

              {error && <p className="text-sm text-red-400">{error}</p>}

              <button
                type="button"
                onClick={() => create.mutate()}
                disabled={create.isPending || (type === 'bandwidth_exceeded' && !deviceId)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add rule
              </button>
            </div>
          </div>
          )}

          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Your rules
            </h2>
            {rules.isLoading ? (
              <p className="mt-4 text-sm text-slate-500">Loading…</p>
            ) : rules.data?.data.length ? (
              <ul className="mt-4 space-y-2">
                {rules.data.data.map((rule) => (
                  <li
                    key={rule.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-200">
                        {RULE_LABELS[rule.alertType]}
                      </p>
                      <p className="text-xs text-slate-500">
                        {rule.deviceId
                          ? devices.find((d) => d.id === rule.deviceId)?.name ?? 'Specific device'
                          : 'Any device'}
                        {rule.threshold != null && ` · ${rule.threshold} Mbps`}
                        {rule.triggerCount > 0 && ` · fired ${rule.triggerCount}×`}
                      </p>
                    </div>
                    {permissions.canManage && (
                    <button
                      type="button"
                      aria-label="Delete rule"
                      onClick={() => remove.mutate(rule.id)}
                      className="shrink-0 text-slate-500 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No rules yet.</p>
            )}
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                <Bell className="h-4 w-4" />
                Activity
              </h2>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markAllRead.mutate()}
                  disabled={markAllRead.isPending}
                  className="text-xs font-medium text-blue-400 hover:text-blue-300 disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}
            </div>
            {activity.isLoading ? (
              <p className="mt-4 text-sm text-slate-500">Loading…</p>
            ) : notifications.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                Nothing yet. Alerts appear here as they fire.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-800">
                {notifications.map((n) => (
                  <li key={n.id} className="flex items-start gap-3 py-3">
                    <span
                      className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY_STYLES[n.priority]}`}
                    >
                      {n.priority}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-200">
                        {n.title}
                        {!n.isRead && <span className="ml-2 text-blue-400">●</span>}
                      </p>
                      <p className="text-sm text-slate-400">{n.message}</p>
                      <p className="text-xs text-slate-600">
                        {new Date(n.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {!n.isRead && (
                      <button
                        type="button"
                        aria-label="Mark as read"
                        onClick={() => acknowledge.mutate(n.id)}
                        className="shrink-0 text-slate-500 hover:text-slate-200"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
