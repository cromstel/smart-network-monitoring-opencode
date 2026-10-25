import Link from 'next/link'
import { appName } from '@/lib/config/app'
import { LoginFormBoundary } from './LoginForm'

/**
 * A server component, so `appName()` reads `APP_NAME` on the server.
 *
 * The interactive form lives in `./LoginForm`, which carries `'use client'`.
 * The split is load-bearing: `process.env.APP_NAME` is `undefined` in the
 * browser bundle, so a name read from a client component renders as nothing —
 * or, as happened during the E2E run, throws. The form is the only part that
 * needs interactivity, so it is the only part marked as a client component.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-4">
          <svg width="36" height="36" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Network Monitor logo" className="drop-shadow-sm">
            <rect x="6" y="6" width="36" height="36" rx="10" fill="#3b82f6" opacity="0.15" />
            <rect x="6" y="6" width="36" height="36" rx="10" stroke="#3b82f6" strokeWidth="2.5" />
            <path d="M14 24 L24 14 L34 24" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="24" cy="26" r="3" fill="#3b82f6" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-slate-400">{appName()}</p>

        <LoginFormBoundary />

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
