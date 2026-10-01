'use client'

import { Suspense, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const redirect = params.get('redirect') || '/'

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
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-300">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-slate-100 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-300">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-slate-100 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-slate-400">Home Network Monitor</p>

        {/* useSearchParams opts the subtree into client rendering, so the
            static shell needs a Suspense boundary around it. */}
        <Suspense
          fallback={<div className="mt-8 h-64 animate-pulse rounded-lg bg-slate-800/40" />}
        >
          <LoginForm />
        </Suspense>

        <p className="mt-6 text-xs text-slate-500">
          First run?{' '}
          <Link href="/auth/setup" className="text-blue-400 hover:underline">
            Create the admin account
          </Link>
        </p>
      </div>
    </main>
  )
}
