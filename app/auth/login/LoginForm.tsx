'use client'

import { Suspense, useState, type FormEvent, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { safeRedirect } from '@/lib/utils/redirect'

/**
 * Card chrome + identity shared by the loaded form and the Suspense fallback,
 * so the logo and app-name heading stay on screen while `useSearchParams()`
 * suspends — the fallback previously replaced the whole card.
 */
function CardShell({ appName, children }: { appName: string; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden border border-white/[0.06] bg-[#0b1224]/70 shadow-[0_0_60px_-15px_rgba(59,130,246,0.15)] backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 pt-6">
        <img src="/logo.avif" alt="Network Monitor logo" width="48" height="48" className="h-12 w-12" />
        <h1 className="text-[10px] font-medium uppercase tracking-[0.35em] text-amber-300/70">
          {appName}
        </h1>
      </div>
      {children}
    </div>
  )
}

function LoginForm({ appName }: { appName: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const redirect = safeRedirect(params.get('redirect'))

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (res.ok) {
        router.replace(redirect)
        router.refresh()
        return
      }
      if (res.status === 429) {
        const retry = res.headers.get('Retry-After')
        setError(`Too many attempts. Try again in ${retry ?? 'a few'}s.`)
      } else {
        const body = await res.json().catch(() => null)
        setError(body?.message ?? 'Sign in failed')
      }
    } catch {
      setError('Network error — is the server running?')
    } finally {
      setPending(false)
    }
  }

  return (
    <CardShell appName={appName}>
      <form onSubmit={onSubmit} className="space-y-5 px-6 pb-6 pt-4" aria-label="Sign in">
      <div>
        <label htmlFor="email" className="block text-xs font-medium uppercase tracking-widest text-slate-400">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="admin@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-2 w-full border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-400/60 focus:outline-none focus:ring-2 focus:ring-blue-400/20 transition"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-xs font-medium uppercase tracking-widest text-slate-400">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2 w-full border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-400/60 focus:outline-none focus:ring-2 focus:ring-blue-400/20 transition"
        />
      </div>

      {error && (
        <p role="alert" aria-live="assertive" className="border border-red-900/60 bg-red-950/30 px-3 py-2.5 text-sm text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        aria-disabled={pending}
        className="w-full bg-gradient-to-r from-blue-600 to-blue-400 px-4 py-3 text-sm font-medium text-white shadow-[0_4px_20px_rgba(59,130,246,0.35)] transition hover:brightness-110 hover:shadow-[0_6px_28px_rgba(59,130,246,0.45)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
    </CardShell>
  )
}

export function LoginFormBoundary({ appName }: { appName: string }) {
  return (
    <Suspense fallback={
      <CardShell appName={appName}>
        <div className="space-y-5 px-6 pb-6 pt-4" aria-hidden="true">
          <div className="h-11 bg-white/[0.05] animate-pulse" />
          <div className="h-11 bg-white/[0.05] animate-pulse" />
          <div className="h-10 bg-white/[0.05] animate-pulse" />
        </div>
      </CardShell>
    }>
      <LoginForm appName={appName} />
    </Suspense>
  )
}
