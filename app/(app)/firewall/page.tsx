'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Power, Shield, ShieldOff, Trash2 } from 'lucide-react'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { useDevices } from '@/lib/hooks/useDevices'
import type { DeviceDTO } from '@/lib/api/serialisers'

/**
 * The firewall screen: block whole devices, and block single destinations for
 * a device.
 *
 * Both halves read from the same device list the Devices page uses, so a
 * device blocked here shows "Blocked" there without a second fetch — the
 * device DTO already carries `isBlocked`. The rules have their own endpoint
 * because they are a table of their own, not a field on a device.
 *
 * Role-gating follows the app's convention (see the alerts page): the form and
 * the destructive controls are hidden from VIEWERs, but every handler is
 * re-checked server-side, which is the check that actually decides. Hiding is
 * a courtesy, never the control.
 */

interface FirewallRule {
  id: string
  deviceId: string
  deviceLabel: string
  macAddress: string
  ipAddress: string
  websiteApp: string
  isActive: boolean
  createdBy: string
  createdAt: string
}

// The same chain the device table and the API's ordering use: a device is
// always labelled, even when it has neither a name nor a hostname.
function deviceLabel(device: DeviceDTO): string {
  return device.deviceName || device.hostname || device.macAddress
}

const cardClass = 'rounded-lg border border-slate-800 bg-slate-950/50 p-5'
const sectionTitleClass = 'text-sm font-semibold uppercase tracking-wide text-slate-400'
const controlClass =
  'bg-slate-800/50 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50'

export default function FirewallPage() {
  const queryClient = useQueryClient()
  const { permissions } = useCurrentUser()
  // ADMIN only, matching every mutating route on this page (`requireAuth(['ADMIN'])`).
  // `isAdmin` fails closed while the role loads, so a non-admin never sees a
  // control that would be refused — and the routes re-check regardless.
  const canManage = permissions?.isAdmin === true

  const [error, setError] = useState<string | null>(null)
  const [targetDevice, setTargetDevice] = useState('')
  const [blockDeviceId, setBlockDeviceId] = useState('')
  const [websiteApp, setWebsiteApp] = useState('')

  // One shared device list: the pickers need every device, and the blocked
  // section is a filter over it, so there is nothing to keep in sync.
  const devices = useDevices({ page: 1, pageSize: 100 })

  const rules = useQuery({
    queryKey: ['firewall-rules'],
    queryFn: async () => {
      const res = await fetch('/api/firewall/rules')
      if (!res.ok) throw new Error('Failed to load firewall rules')
      return (await res.json()) as { data: FirewallRule[] }
    },
  })

  const deviceOptions = useMemo(() => devices.data ?? [], [devices.data])
  const blockedDevices = useMemo(
    () => deviceOptions.filter((d) => d.isBlocked),
    [deviceOptions],
  )
  const blockableDevices = useMemo(
    () => deviceOptions.filter((d) => !d.isBlocked),
    [deviceOptions],
  )

  const refreshRules = () => {
    queryClient.invalidateQueries({ queryKey: ['firewall-rules'] })
    // The device list carries isBlocked; a block applied here must show up on
    // the Devices page and the overview without a manual reload.
    queryClient.invalidateQueries({ queryKey: ['devices'] })
    queryClient.invalidateQueries({ queryKey: ['overview'] })
  }

  const readPayload = async (res: Response) => {
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error(body?.message ?? `Request failed (${res.status})`)
    }
  }

  const setDeviceBlocked = useMutation({
    mutationFn: async ({ deviceId, isBlocked }: { deviceId: string; isBlocked: boolean }) => {
      const res = await fetch(`/api/firewall/devices/${deviceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isBlocked }),
      })
      await readPayload(res)
    },
    onSuccess: (_data, variables) => {
      setError(null)
      setBlockDeviceId('')
      refreshRules()
      if (variables.isBlocked) setTargetDevice('')
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to update device'),
  })

  const createRule = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/firewall/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: targetDevice, websiteApp }),
      })
      await readPayload(res)
    },
    onSuccess: () => {
      setError(null)
      setWebsiteApp('')
      queryClient.invalidateQueries({ queryKey: ['firewall-rules'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create rule'),
  })

  const toggleRule = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await fetch(`/api/firewall/rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      await readPayload(res)
    },
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['firewall-rules'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to update rule'),
  })

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/firewall/rules/${id}`, { method: 'DELETE' })
      // 404 means somebody else deleted it first: the end state is the one the
      // user asked for, so it is not an error worth surfacing.
      if (res.status !== 404) await readPayload(res)
    },
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['firewall-rules'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to delete rule'),
  })

  const busy =
    setDeviceBlocked.isPending || createRule.isPending || toggleRule.isPending || deleteRule.isPending

  return (
    <section className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Firewall</h1>
        <p className="mt-1 text-sm text-slate-400">
          Block devices from the network entirely, or block a single site or app for one device.
        </p>
      </header>

      {error && (
        <p className="mb-6 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------- Device blocking ---------- */}
        <div className={cardClass}>
          <h2 className={`mb-4 flex items-center gap-2 ${sectionTitleClass}`}>
            <Shield className="h-4 w-4" aria-hidden />
            Blocked devices
          </h2>

          {canManage && (
            <div className="mb-5 flex flex-col gap-2 sm:flex-row">
              <select
                aria-label="Device to block"
                value={blockDeviceId}
                onChange={(e) => setBlockDeviceId(e.target.value)}
                disabled={busy || blockableDevices.length === 0}
                className={`flex-1 px-3 py-2 text-sm ${controlClass}`}
              >
                <option value="">
                  {blockableDevices.length === 0 ? 'Every device is blocked' : 'Select a device…'}
                </option>
                {blockableDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {deviceLabel(d)} ({d.macAddress})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !blockDeviceId}
                onClick={() =>
                  blockDeviceId && setDeviceBlocked.mutate({ deviceId: blockDeviceId, isBlocked: true })
                }
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                <ShieldOff className="h-4 w-4" aria-hidden />
                Block device
              </button>
            </div>
          )}

          {devices.isLoading ? (
            <p className="py-6 text-center text-sm text-slate-400">Loading devices…</p>
          ) : blockedDevices.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              No devices are blocked. A blocked device cannot use the network at all.
            </p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {blockedDevices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-200">{deviceLabel(d)}</p>
                    <p className="truncate text-xs text-slate-500">
                      {d.macAddress} · {d.ipAddress}
                    </p>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setDeviceBlocked.mutate({ deviceId: d.id, isBlocked: false })}
                      className="inline-flex shrink-0 items-center gap-2 rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Power className="h-3.5 w-3.5" aria-hidden />
                      Unblock
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---------- Site & app rules ---------- */}
        <div className={cardClass}>
          <h2 className={`mb-4 flex items-center gap-2 ${sectionTitleClass}`}>
            <ShieldOff className="h-4 w-4" aria-hidden />
            Site &amp; app rules
          </h2>

          {canManage && (
            <div className="mb-5 flex flex-col gap-2 sm:flex-row">
              <select
                aria-label="Device for the rule"
                value={targetDevice}
                onChange={(e) => setTargetDevice(e.target.value)}
                disabled={busy || deviceOptions.length === 0}
                className={`flex-1 px-3 py-2 text-sm ${controlClass}`}
              >
                <option value="">Select a device…</option>
                {deviceOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {deviceLabel(d)} ({d.macAddress})
                  </option>
                ))}
              </select>
              <input
                type="text"
                aria-label="Site or app to block"
                placeholder="example.com"
                value={websiteApp}
                onChange={(e) => setWebsiteApp(e.target.value)}
                disabled={busy}
                className={`flex-1 px-3 py-2 text-sm ${controlClass}`}
              />
              <button
                type="button"
                disabled={busy || !targetDevice || !websiteApp.trim()}
                onClick={() => createRule.mutate()}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                Add rule
              </button>
            </div>
          )}

          {rules.isLoading ? (
            <p className="py-6 text-center text-sm text-slate-400">Loading rules…</p>
          ) : rules.data && rules.data.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="py-2 text-left font-medium">Device</th>
                    <th scope="col" className="py-2 text-left font-medium">Site / app</th>
                    <th scope="col" className="py-2 text-left font-medium">State</th>
                    <th scope="col" className="py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {rules.data.data.map((rule) => (
                    <tr key={rule.id}>
                      <td className="py-3 pr-4">
                        <span className="block font-medium text-slate-200">{rule.deviceLabel}</span>
                        <span className="block text-xs text-slate-500">{rule.macAddress}</span>
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-slate-300">{rule.websiteApp}</td>
                      <td className="py-3 pr-4">
                        <span
                          className={[
                            'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                            rule.isActive
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-slate-700 text-slate-400',
                          ].join(' ')}
                        >
                          {rule.isActive ? 'Blocking' : 'Paused'}
                        </span>
                      </td>
                      <td className="py-3">
                        {canManage && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => toggleRule.mutate({ id: rule.id, isActive: !rule.isActive })}
                              className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
                            >
                              {rule.isActive ? 'Pause' : 'Resume'}
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete rule for ${rule.websiteApp}`}
                              disabled={busy}
                              onClick={() => deleteRule.mutate(rule.id)}
                              className="rounded-md border border-slate-700 px-2 py-1 text-red-400 transition-colors hover:bg-slate-800 disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-slate-400">
              No site or app rules yet. A rule keeps the device online but blocks one destination.
            </p>
          )}
        </div>
      </div>

      {busy && (
        <p className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Applying…
        </p>
      )}
    </section>
  )
}
