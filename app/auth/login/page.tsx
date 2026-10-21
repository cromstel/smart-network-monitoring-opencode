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
