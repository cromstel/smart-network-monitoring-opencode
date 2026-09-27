'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'

interface Settings {
  networkSubnet: string
  scanIntervalSeconds: number
  dataRetentionDays: number
  notifyNewDevices: boolean
  notifyDeviceOffline: boolean
  notifyHighBandwidth: boolean
  bandwidthThreshold: number
  theme: 'dark' | 'light'
}

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Partial<Settings>>({})
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings')
      if (res.status === 403) throw new Error('Only admins can change settings')
      if (!res.ok) throw new Error('Failed to load settings')
      return (await res.json()) as { data: Settings }
    },
  })

  const save = useMutation({
    mutationFn: async (payload: Partial<Settings>) => {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? 'Failed to save settings')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setForm({})
      setMessage({ tone: 'ok', text: 'Saved. The scan interval applies from the next cycle.' })
    },
    onError: (e) => setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Save failed' }),
  })

  const current: Settings | undefined = settings.data?.data
  const value = <K extends keyof Settings>(key: K): Settings[K] | undefined =>
    (form[key] as Settings[K]) ?? current?.[key]

  if (settings.isLoading) {
    return (
      <p className="flex items-center gap-2 text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
      </p>
    )
  }

  if (settings.isError) {
    return <p className="text-sm text-red-400">{(settings.error as Error).message}</p>
  }

  return (
    <section className="max-w-2xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Per-account preferences. Only admins can change them.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (Object.keys(form).length > 0) save.mutate(form)
        }}
        className="space-y-6 rounded-lg border border-slate-800 bg-slate-950/50 p-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-slate-300">
            Subnet (CIDR)
            <input
              value={value('networkSubnet') ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, networkSubnet: e.target.value }))}
              placeholder="192.168.1.0/24"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
            />
          </label>

          <label className="block text-sm text-slate-300">
            Scan interval (seconds, 30–3600)
            <input
              type="number"
              min={30}
              max={3600}
              value={value('scanIntervalSeconds') ?? 30}
              onChange={(e) =>
                setForm((f) => ({ ...f, scanIntervalSeconds: Number(e.target.value) }))
              }
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
            />
          </label>

          <label className="block text-sm text-slate-300">
            Retention (days, 1–365)
            <input
              type="number"
              min={1}
              max={365}
              value={value('dataRetentionDays') ?? 30}
              onChange={(e) =>
                setForm((f) => ({ ...f, dataRetentionDays: Number(e.target.value) }))
              }
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
            />
          </label>

          <label className="block text-sm text-slate-300">
            Bandwidth threshold (Mbps)
            <input
              type="number"
              min={0}
              value={value('bandwidthThreshold') ?? 100}
              onChange={(e) =>
                setForm((f) => ({ ...f, bandwidthThreshold: Number(e.target.value) }))
              }
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
            />
          </label>

          <label className="block text-sm text-slate-300">
            Theme
            <select
              value={value('theme') ?? 'dark'}
              onChange={(e) => setForm((f) => ({ ...f, theme: e.target.value as Settings['theme'] }))}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-300">Notifications</legend>
          {(
            [
              ['notifyNewDevices', 'New device detected'],
              ['notifyDeviceOffline', 'Device went offline'],
              ['notifyHighBandwidth', 'Bandwidth threshold exceeded'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={value(key) ?? false}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800"
              />
              {label}
            </label>
          ))}
        </fieldset>

        {message && (
          <p
            role="status"
            className={
              message.tone === 'ok'
                ? 'text-sm text-emerald-400'
                : 'rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300'
            }
          >
            {message.text}
          </p>
        )}

        <button
          type="submit"
          disabled={save.isPending || Object.keys(form).length === 0}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </section>
  )
}
