'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { appName } from '@/lib/config/app'

export default function ResetPasswordPage() {
  const params = useSearchParams()
  const router = useRouter()
  const token = params.get('token') ?? ''

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setPending(true)

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      setPending(false)
      return
    }

    try {
      const res = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.message ?? 'Reset failed')
        return
      }
      setMessage('Password reset successfully. Redirecting to sign in…')
      setTimeout(() => router.replace('/auth/login'), 1500)
    } catch {
      setError('Network error — is the server running?')
    } finally {
      setPending(false)
    }
  }

  if (!token) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#070d1a] px-6 py-20 sm:px-10">
        <div className="relative overflow-hidden border border-white/[0.06] bg-[#0b1224]/70 shadow-[0_0_60px_-15px_rgba(59,130,246,0.15)] backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 pt-6">
            <img src="/logo.avif" alt="Network Monitor logo" width="48" height="48" className="h-12 w-12" />
            <h1 className="text-[10px] sm:text-xs font-medium uppercase tracking-[0.35em] text-amber-300/70">
              {appName()}
            </h1>
          </div>
          <div className="space-y-5 px-6 pb-6 pt-4" aria-label="Reset password">
            <p className="text-sm text-slate-300">No reset code provided.</p>
            <p className="text-xs text-slate-500">
              Request a code at{' '}
              <Link href="/auth/forgot-password" className="text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline">
                forgot password
              </Link>
              .
            </p>
          </div>
        </div>
      </main>
    )
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
        <form onSubmit={onSubmit} className="space-y-5 px-6 pb-6 pt-4" aria-label="Reset password">
          <div>
            <label htmlFor="new-password" className="block text-xs font-medium uppercase tracking-widest text-slate-400">
              New password
            </label>
            <input
              id="new-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-2 w-full border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-400/60 focus:outline-none focus:ring-2 focus:ring-blue-400/20 transition"
            />
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-xs font-medium uppercase tracking-widest text-slate-400">
              Confirm password
            </label>
            <input
              id="confirm-password"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
            {pending ? 'Resetting…' : 'Reset password'}
          </button>
        </form>
      </div>

      <p className="mt-6 text-xs text-slate-500">
        Don't have a code?{' '}
        <Link href="/auth/forgot-password" className="text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline">
          Request one
        </Link>
      </p>
      <p className="text-xs text-slate-500">
        Remember your password?{' '}
        <Link href="/auth/login" className="text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  )
}
