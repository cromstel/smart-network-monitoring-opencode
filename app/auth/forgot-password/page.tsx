'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { appName } from '@/lib/config/app'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setPending(true)
    try {
      const res = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.message ?? 'Reset request failed')
        return
      }
      setMessage('If an account exists for that email, a reset code has been sent.')
    } catch {
      setError('Network error — is the server running?')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#070d1a] px-6 py-20 sm:px-10">
      <div className="relative overflow-hidden border border-white/[0.06] bg-[#0b1224]/70 shadow-[0_0_60px_-15px_rgba(59,130,246,0.15)] backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3 pt-6">
          <img src="/logo.avif" alt="Network Monitor logo" width="48" height="48" className="h-12 w-12" />
          <h1 className="text-[10px] sm:text-xs font-medium uppercase tracking-[0.35em] text-amber-300/70">
            {appName()}
          </h1>
        </div>
        <form onSubmit={onSubmit} className="space-y-5 px-6 pb-6 pt-4" aria-label="Forgot password">
          <div>
            <label htmlFor="email" className="block text-xs font-medium uppercase tracking-widest text-slate-400">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-400/60 focus:outline-none focus:ring-2 focus:ring-blue-400/20 transition"
            />
          </div>

          {error && (
            <p role="alert" aria-live="assertive" className="border border-red-900/60 bg-red-950/30 px-3 py-2.5 text-sm text-red-300">
              {error}
            </p>
          )}

          {message && (
            <p role="status" aria-live="polite" className="border border-emerald-900/60 bg-emerald-950/30 px-3 py-2.5 text-sm text-emerald-300">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-400 px-4 py-3 text-sm font-medium text-white shadow-[0_4px_20px_rgba(59,130,246,0.35)] transition hover:brightness-110 hover:shadow-[0_6px_28px_rgba(59,130,246,0.45)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Sending…' : 'Send reset code'}
          </button>
        </form>
      </div>

      <p className="mt-6 text-xs text-slate-500">
        Already have a code?{' '}
        <Link href="/auth/reset-password" className="text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline">
          Enter reset code
        </Link>
      </p>
      <p className="text-xs text-slate-500">
        Don't have an account?{' '}
        <Link href="/auth/setup" className="text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline">
          Create the admin account
        </Link>
      </p>
    </main>
  )
}
