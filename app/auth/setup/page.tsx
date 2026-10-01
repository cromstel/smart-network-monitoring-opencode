'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Status = 'checking' | 'needed' | 'done'

export default function SetupPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('checking')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/setup')
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        if (body?.data?.setupComplete) {
          setStatus('done')
          router.replace('/auth/login')
        } else {
          setStatus('needed')
        }
      })
      .catch(() => !cancelled && setStatus('needed'))
    return () => {
      cancelled = true
    }
  }, [router])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }

    setPending(true)
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: name || undefined }),
      })

      if (res.ok) {
        router.replace('/auth/login')
        router.refresh()
        return
      }

      const body = await res.json().catch(() => null)
      setError(body?.message ?? 'Setup failed')
    } catch {
      setError('Network error — is the server running?')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Create the admin account</h1>
        <p className="mt-1 text-sm text-slate-400">
          This runs once. The first account has the ADMIN role.
        </p>

        {status === 'checking' && (
          <p className="mt-8 text-sm text-slate-500">Checking…</p>
        )}

        {status === 'done' && (
          <p className="mt-8 text-sm text-slate-400">
            Setup is already complete. <Link href="/auth/login" className="text-blue-400 hover:underline">Sign in</Link>
          </p>
        )}

        {status === 'needed' && (
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-300">
                Name <span className="text-slate-500">(optional)</span>
              </label>
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-slate-100 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

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
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-slate-100 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                At least 12 characters with upper case, lower case and a digit.
              </p>
            </div>

            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-slate-300">
                Confirm password
              </label>
              <input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
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
              {pending ? 'Creating…' : 'Create admin account'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
