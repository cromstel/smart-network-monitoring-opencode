'use client'

import { Suspense, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { safeRedirect } from '@/lib/utils/redirect'

function LoginForm() {
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
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0b1224]/70 shadow-[0_0_60px_-15px_rgba(59,130,246,0.15)] backdrop-blur-sm">
      {/* Logo inside form card */}
      <div className="flex justify-center pt-6">
        <img src="/logo.svg" alt="Network Monitor logo" width="48" height="48" />
      </div>
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
          className="mt-2 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-400/60 focus:outline-none focus:ring-2 focus:ring-blue-400/20 transition"
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
          className="mt-2 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-400/60 focus:outline-none focus:ring-2 focus:ring-blue-400/20 transition"
        />
      </div>

      {error && (
        <p role="alert" aria-live="assertive" className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2.5 text-sm text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        aria-disabled={pending}
        className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-400 px-4 py-3 text-sm font-medium text-white shadow-[0_4px_20px_rgba(59,130,246,0.35)] transition hover:brightness-110 hover:shadow-[0_6px_28px_rgba(59,130,246,0.45)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
    </div>
  )
}

export function LoginFormBoundary() {
  return (
    <Suspense fallback={
      <div className="space-y-5">
        <div className="h-11 rounded-xl bg-white/[0.05] animate-pulse" />
        <div className="h-11 rounded-xl bg-white/[0.05] animate-pulse" />
        <div className="h-10 rounded-xl bg-white/[0.05] animate-pulse" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
