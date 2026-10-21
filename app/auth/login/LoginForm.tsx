'use client'

import { Suspense, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { safeRedirect } from '@/lib/utils/redirect'

/**
 * The interactive half of the sign-in page, moved out of `page.tsx` so that
 * file can be a server component and read `APP_NAME` on the server.
 *
 * `'use client'` has to be the *outermost* boundary here. An earlier attempt
 * put `'use client'` on the page and imported a server component for the name:
 * importing a server component from a client module pulls it into the client
 * graph, so `process.env.APP_NAME` was read in the browser, where it is always
 * `undefined`. The failure surfaced as a `MissingAppIdentityError` thrown from
 * a `_next/static/chunks/...` frame during the E2E run — a stack that can only
 * ever be the client bundle.
 *
 * The markup is unchanged from the version that lived in `page.tsx`.
 */

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  // The middleware sets ?redirect= to the path that was denied, so a deep link
  // survives the login detour. It is user-supplied all the same, so it is
  // validated rather than trusted: without this, a link to
  // /auth/login?redirect=https://elsewhere navigates off-origin after sign-in.
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

/**
 * Wraps the form in the `Suspense` boundary `useSearchParams` requires.
 *
 * Exported as a whole so the server page composes `<LoginForm />` without
 * knowing about the boundary — the requirement belongs to this file, with the
 * hook that creates it.
 */
export function LoginFormBoundary() {
  return (
    <Suspense fallback={<div className="mt-8 h-64 animate-pulse rounded-lg bg-slate-800/40" />}>
      <LoginForm />
    </Suspense>
  )
}
