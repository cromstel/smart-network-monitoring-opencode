'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'

/** What GET /api/settings returns — never the credential values, only whether one is set. */
interface Settings {
  networkSubnet: string
  scanIntervalSeconds: number
  dataRetentionDays: number
  notifyNewDevices: boolean
  notifyDeviceOffline: boolean
  notifyHighBandwidth: boolean
  bandwidthThreshold: number
  theme: 'dark' | 'light'
  paystackApiUrl: string
  paystackSubscriptionId: string
  paystackSecretSet: boolean
  paystackAccessTokenSet: boolean
}

/** What GET /api/router-config returns — never the credential. */
interface RouterConfigView {
  routerType: string
  routerIp: string
  port: number
  username: string
  routerName: string | null
}

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Partial<Settings>>({})
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [tab, setTab] = useState<'general' | 'router' | 'paystack' | 'smtp'>('general')

  const { permissions } = useCurrentUser()

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
      setPaystackForm({ apiUrl: '', secret: '', accessToken: '', subscriptionId: '' })
      setMessage({ tone: 'ok', text: 'Saved. The scan interval applies from the next cycle.' })
    },
    onError: (e) => setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Save failed' }),
  })

  // --- PayStack billing (B-67). A separate form and mutation because it posts
  // to the same endpoint with the same ADMIN gate, but the credentials are
  // write-only: they are never returned by GET, so the inputs always start
  // blank and only a submitted value changes the stored one. Same reasoning as
  // the router password above, and the same password input type.
  const [paystackForm, setPaystackForm] = useState({
    apiUrl: '',
    secret: '',
    accessToken: '',
    subscriptionId: '',
  })
  const [paystackMessage, setPaystackMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(
    null
  )

  const savePaystack = useMutation({
    mutationFn: async (payload: {
      paystackApiUrl?: string
      paystackSecret?: string
      paystackAccessToken?: string
      paystackSubscriptionId?: string
    }) => {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? 'Failed to save PayStack settings')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setPaystackForm({ apiUrl: '', secret: '', accessToken: '', subscriptionId: '' })
      setPaystackMessage({ tone: 'ok', text: 'PayStack saved.' })
    },
    onError: (e) =>
      setPaystackMessage({
        tone: 'error',
        text: e instanceof Error ? e.message : 'Failed to save PayStack settings',
      }),
  })

  // --- Router configuration (F-40): a separate form and mutation because it
  // posts to a different endpoint with its own ADMIN gate and its own
  // success/error state. The password is write-only: it is encrypted on the
  // server and never returned, so the field always starts blank.
  const [routerForm, setRouterForm] = useState({
    routerType: 'asus',
    routerIp: '',
    port: '80',
    username: 'admin',
    password: '',
  })
    // --- SMTP email provider (admin-only). Reuses /api/admin/email-providers.
  const [smtpForm, setSmtpForm] = useState({ providerName: '', smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '', isDefault: false, id: '', preset: '' })

  const presetProviders = [
    { id: "gmail", name: "Gmail", host: "smtp.gmail.com", port: 587, user: "" },
    { id: "outlook", name: "Outlook", host: "smtp-mail.outlook.com", port: 587, user: "" },
    { id: "yahoo", name: "Yahoo Mail", host: "smtp.mail.yahoo.com", port: 587, user: "" },
    { id: "sendgrid", name: "SendGrid", host: "smtp.sendgrid.net", port: 587, user: "apikey" },
    { id: "mailgun", name: "Mailgun", host: "smtp.mailgun.org", port: 587, user: "postmaster@your-domain" },
  ]
  const [smtpMessage, setSmtpMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const emailProviders = useQuery({
    queryKey: ['email-providers'],
    queryFn: async () => {
      const res = await fetch('/api/admin/email-providers')
      if (!res.ok) throw new Error('Failed to load email providers')
      return (await res.json()) as { success: boolean; data: any[] }
    },
  })
  const saveSmtp = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch('/api/admin/email-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message || body?.error || 'Failed to save SMTP provider')
      }
      return await res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-providers'] })
      setSmtpForm((f) => ({ ...f, smtpPass: '' }))
      setSmtpMessage({ tone: 'ok', text: 'SMTP provider saved.' })
    },
    onError: (e) => setSmtpMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Save failed' }),
  })

  const [routerMessage, setRouterMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const routerConfig = useQuery({
    queryKey: ['router-config'],
    queryFn: async () => {
      const res = await fetch('/api/router-config')
      if (!res.ok) throw new Error('Failed to load router config')
      return (await res.json()) as { data: RouterConfigView | null }
    },
  })

  const saveRouter = useMutation({
    mutationFn: async (payload: {
      routerType: string
      routerIp: string
      port: number
      username: string
      password: string
    }) => {
      const res = await fetch('/api/router-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? 'Failed to save router config')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['router-config'] })
      setRouterForm((f) => ({ ...f, password: '' }))
      setRouterMessage({
        tone: 'ok',
        text: 'Router saved. It is used on the next scan cycle if it answers.',
      })
    },
    onError: (e) => setRouterMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Save failed' }),
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
        <p className="mt-1 text-sm text-slate-400">Per-account preferences. Only admins can change them.</p>
        <nav className="mt-3 flex gap-2 border-b border-slate-800 pb-1">
          {(['general', 'router', 'paystack', 'smtp'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                'px-3 py-1.5 text-sm font-medium rounded-t-md transition-colors ' +
                (tab === t ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60')
              }
            >
              {t === 'general' ? 'General' : t === 'router' ? 'Router' : t === 'paystack' ? 'Billing' : 'SMTP'}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'general' && (
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

        {permissions.isAdmin && (
          <button
            type="submit"
            disabled={save.isPending || Object.keys(form).length === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </form>
      )}

      {tab === 'router' && (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const ip = routerForm.routerIp.trim()
          const port = Number(routerForm.port)
          if (!ip) {
            setRouterMessage({ tone: 'error', text: 'Router IP is required.' })
            return
          }
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            setRouterMessage({ tone: 'error', text: 'Port must be a number between 1 and 65535.' })
            return
          }
          if (!routerForm.password) {
            setRouterMessage({ tone: 'error', text: 'Password is required on every save.' })
            return
          }
          saveRouter.mutate({
            routerType: routerForm.routerType,
            routerIp: ip,
            port,
            username: routerForm.username.trim() || 'admin',
            password: routerForm.password,
          })
        }}
        className="space-y-4 rounded-lg border border-slate-800 bg-slate-950/50 p-5"
      >
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-slate-300">Router (ASUS) — optional</legend>
          <p className="text-xs text-slate-500">
            When configured, the router API is used for discovery instead of ARP or simulated
            scanning. The password is stored encrypted (AES-256-GCM), never shown again, and is
            required on every save.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-300">
              Type
              <select
                value={routerForm.routerType}
                onChange={(e) => setRouterForm((f) => ({ ...f, routerType: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
              >
                <option value="asus">ASUS</option>
                <option value="tplink">TP-Link</option>
                <option value="netgear">Netgear</option>
                <option value="generic">Generic</option>
              </select>
            </label>

            <label className="block text-sm text-slate-300">
              Router IP
              <input
                value={routerForm.routerIp}
                onChange={(e) => setRouterForm((f) => ({ ...f, routerIp: e.target.value }))}
                placeholder="192.168.1.1"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
              />
            </label>

            <label className="block text-sm text-slate-300">
              Port
              <input
                type="number"
                min={1}
                max={65535}
                value={routerForm.port}
                onChange={(e) => setRouterForm((f) => ({ ...f, port: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
              />
            </label>

            <label className="block text-sm text-slate-300">
              Username
              <input
                value={routerForm.username}
                onChange={(e) => setRouterForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="admin"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
              />
            </label>

            <label className="block text-sm col-span-full text-slate-300">
              Password
              <input
                type="password"
                autoComplete="new-password"
                value={routerForm.password}
                onChange={(e) => setRouterForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={
                  routerConfig.data?.data ? 'Stored — type to replace' : 'Router admin password'
                }
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
              />
            </label>
          </div>
        </fieldset>

        <p className="text-xs text-slate-500">
          {routerConfig.data?.data
            ? `Saved: ${routerConfig.data.data.routerType} @ ${routerConfig.data.data.routerIp}:${routerConfig.data.data.port} (${routerConfig.data.data.username})`
            : routerConfig.isError
              ? 'Could not load the saved router configuration.'
              : 'No router configured yet.'}
        </p>

        {routerMessage && (
          <p
            role="status"
            className={
              routerMessage.tone === 'ok'
                ? 'text-sm text-emerald-400'
                : 'rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300'
            }
          >
            {routerMessage.text}
          </p>
        )}

        {permissions.isAdmin && (
          <button
            type="submit"
            disabled={saveRouter.isPending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saveRouter.isPending ? 'Saving…' : 'Save router'}
          </button>
        )}
      </form>
      )}

      {tab === 'paystack' && (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const apiUrl = paystackForm.apiUrl.trim()
          if (apiUrl && !/^https?:\/\/.+/.test(apiUrl)) {
            setPaystackMessage({ tone: 'error', text: 'API URL must start with http:// or https://.' })
            return
          }
          // Only the fields the admin actually typed. The credentials are
          // write-only, so an empty input must mean "keep what is stored",
          // never "overwrite with empty".
          const payload: Parameters<typeof savePaystack.mutate>[0] = {}
          if (apiUrl) payload.paystackApiUrl = apiUrl
          const subscriptionId = paystackForm.subscriptionId.trim()
          if (subscriptionId) payload.paystackSubscriptionId = subscriptionId
          if (paystackForm.secret) payload.paystackSecret = paystackForm.secret
          if (paystackForm.accessToken) payload.paystackAccessToken = paystackForm.accessToken
          if (Object.keys(payload).length === 0) {
            setPaystackMessage({ tone: 'error', text: 'Enter at least one value to save.' })
            return
          }
          savePaystack.mutate(payload)
        }}
        className="space-y-4 rounded-lg border border-slate-800 bg-slate-950/50 p-5"
      >
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-slate-300">PayStack billing — optional</legend>
          <p className="text-xs text-slate-500">
            Credentials used to talk to the PayStack API. Stored as entered and never shown again;
            leave a field blank to keep the value already saved.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-300">
              API URL
              <input
                value={paystackForm.apiUrl}
                onChange={(e) => setPaystackForm((f) => ({ ...f, apiUrl: e.target.value }))}
                placeholder="https://api.paystack.co"
                inputMode="url"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
              />
            </label>

            <label className="block text-sm text-slate-300">
              Subscription ID
              <input
                value={paystackForm.subscriptionId}
                onChange={(e) => setPaystackForm((f) => ({ ...f, subscriptionId: e.target.value }))}
                placeholder="SUB_xxxxxxxx"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
              />
            </label>

            <label className="block text-sm text-slate-300">
              Secret key
              <input
                type="password"
                autoComplete="new-password"
                value={paystackForm.secret}
                onChange={(e) => setPaystackForm((f) => ({ ...f, secret: e.target.value }))}
                placeholder="Enter PayStack secret key"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
              />
            </label>

            <label className="block text-sm text-slate-300">
              Access token
              <input
                type="password"
                autoComplete="new-password"
                value={paystackForm.accessToken}
                onChange={(e) => setPaystackForm((f) => ({ ...f, accessToken: e.target.value }))}
                placeholder="Bearer token"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
              />
            </label>
          </div>
        </fieldset>

        <p className="text-xs text-slate-500">
          {current?.paystackApiUrl
            ? `Saved: ${current.paystackApiUrl}`
            : 'No PayStack configuration saved yet.'}
        </p>

        <p className="text-xs text-slate-500">
          {current?.paystackSecretSet ? 'Secret key stored' : 'No secret key stored'}
          {' · '}
          {current?.paystackAccessTokenSet ? 'Access token stored' : 'No access token stored'}
        </p>

        {paystackMessage && (
          <p
            role="status"
            className={
              paystackMessage.tone === 'ok'
                ? 'text-sm text-emerald-400'
                : 'rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300'
            }
          >
            {paystackMessage.text}
          </p>
        )}

        {permissions.isAdmin && (
          <button
            type="submit"
            disabled={savePaystack.isPending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {savePaystack.isPending ? 'Saving…' : 'Save PayStack'}
          </button>
        )}
      </form>
      )}

      {tab === 'smtp' && (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const payload: any = {}
          if (smtpForm.providerName.trim()) payload.providerName = smtpForm.providerName.trim()
          if (smtpForm.smtpHost.trim()) payload.smtpHost = smtpForm.smtpHost.trim()
          if (smtpForm.smtpPort) payload.smtpPort = Number(smtpForm.smtpPort)
          if (smtpForm.smtpUser.trim()) payload.smtpUser = smtpForm.smtpUser.trim()
          if (smtpForm.smtpPass) payload.smtpPass = smtpForm.smtpPass
          if (smtpForm.id) payload.id = smtpForm.id
          if (smtpForm.isDefault !== undefined) payload.isDefault = smtpForm.isDefault
          if (Object.keys(payload).length < 1) {
            setSmtpMessage({ tone: 'error', text: 'Enter at least one value to save.' })
            return
          }
          saveSmtp.mutate(payload)
        }}
        className="space-y-4 rounded-lg border border-slate-800 bg-slate-950/50 p-5"
      >
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-slate-300">SMTP email provider � admin only</legend>
          <p className="text-xs text-slate-500">
            Configures the mail server used for admin notifications. The password is write-only and never shown again.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-300">
              Provider preset
              <select
                value={smtpForm.preset || ''}
                onChange={(e) => {
                  const presetId = e.target.value;
                  setSmtpForm((f) => {
                    if (!presetId || presetId === 'custom') return { ...f, preset: 'custom', providerName: f.providerName || '' };
                    const p = presetProviders.find((x) => x.id === presetId);
                    return p ? { ...f, preset: presetId, providerName: p.name, smtpHost: p.host, smtpPort: p.port, smtpUser: p.user || '', smtpPass: '', isDefault: false } : { ...f, preset: 'custom' };
                  });
                }}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
              >
                <option value="">Select a provider...</option>
                <option value="gmail">Gmail</option>
                <option value="outlook">Outlook / Hotmail</option>
                <option value="yahoo">Yahoo Mail</option>
                <option value="sendgrid">SendGrid</option>
                <option value="mailgun">Mailgun</option>
                <option value="custom">Custom provider</option>
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              Provider name
              <input
                value={smtpForm.providerName}
                onChange={(e) => setSmtpForm((f) => ({ ...f, providerName: e.target.value }))}
                placeholder="Custom provider name"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
              />
            </label>
            <label className="block text-sm text-slate-300">
              SMTP host
              <input
                value={smtpForm.smtpHost}
                onChange={(e) => setSmtpForm((f) => ({ ...f, smtpHost: e.target.value }))}
                placeholder="smtp.gmail.com"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
              />
            </label>
            <label className="block text-sm text-slate-300">
              SMTP port
              <input
                type="number"
                min={1}
                max={65535}
                value={smtpForm.smtpPort ?? ''}
                onChange={(e) => setSmtpForm((f) => ({ ...f, smtpPort: e.target.value ? Number(e.target.value) : 587 }))}
                placeholder="587"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
              />
            </label>
            <label className="block text-sm text-slate-300 flex items-center gap-2">
              <input
                type="checkbox"
                checked={smtpForm.isDefault ?? false}
                onChange={(e) => setSmtpForm((f) => ({ ...f, isDefault: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800"
              />
              Set as default
            </label>
            <label className="block text-sm text-slate-300">
              SMTP user
              <input
                value={smtpForm.smtpUser}
                onChange={(e) => setSmtpForm((f) => ({ ...f, smtpUser: e.target.value }))}
                placeholder="user@example.com"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
              />
            </label>
            <label className="block text-sm text-slate-300 col-span-full">
              SMTP password
              <input
                type="password"
                autoComplete="new-password"
                value={smtpForm.smtpPass}
                onChange={(e) => setSmtpForm((f) => ({ ...f, smtpPass: e.target.value }))}
                placeholder="App password / token"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
              />
            </label>
          </div>
        </fieldset>
        <p className="text-xs text-slate-500">
          {emailProviders.data?.data && emailProviders.data.data.length > 0
            ? 'Saved: ' + emailProviders.data.data.map((p) => p.providerName).join(', ')
            : 'No SMTP provider configured yet.'}
        </p>
        {smtpMessage && (
          <p
            role="status"
            className={
              smtpMessage.tone === 'ok'
                ? 'text-sm text-emerald-400'
                : 'rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300'
            }
          >
            {smtpMessage.text}
          </p>
        )}
        {permissions.isAdmin && (
          <button
            type="submit"
            disabled={saveSmtp.isPending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saveSmtp.isPending ? 'Saving...' : 'Save SMTP'}
          </button>
        )}
      </form>
      )}
    </section>
  )
}







