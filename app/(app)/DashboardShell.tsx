'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useEventStream } from '@/lib/hooks/useEventStream'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { ThemeSync, type Theme } from '@/components/ThemeSync'

/**
 * The authenticated shell: sidebar, nav, live indicator, sign-out.
 *
 * A client component because every one of those pieces is interactive. The
 * product name is a **prop**, not a call to `appName()`: `process.env.APP_NAME`
 * is absent in the browser bundle, so reading it here would render an empty
 * heading or throw. The server layout reads it and passes the resulting string
 * down, which is also what lets one image serve several deployments.
 */

// Order is the reading order of the product: what is happening now, then
// what exists, then what to act on, then configuration. '/' is the overview
// and /devices is the list, which is why the nav distinguishes them rather
// than reusing the word Dashboard for both.
const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/devices', label: 'Devices' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/settings', label: 'Settings' },
]

/**
 * F-53: the theme the user actually saved.
 *
 * **This must use the exact same `queryFn` as the settings page.** React Query
 * caches by key alone — it does not know that two call sites intended different
 * shapes. An earlier version of this hook returned the bare theme string while
 * the settings page returned the whole `{ data }` envelope, so whichever
 * component mounted first decided the cached shape for the other. When the
 * settings page won, this hook received an object where it expected a string
 * and silently applied nothing: the setting round-tripped, and the screen never
 * changed.
 *
 * Sharing the key with an identical fetcher is what makes a save here apply
 * immediately — `invalidateQueries({ queryKey: ['settings'] })` refreshes both.
 */
function useThemeSetting(): Theme | undefined {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings')
      if (!res.ok) throw new Error('Failed to load settings')
      return (await res.json()) as { data: { theme?: Theme } }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  return data?.data?.theme ?? undefined
}

export function DashboardShell({
  appName,
  children,
}: Readonly<{ appName: string; children: React.ReactNode }>) {
  const pathname = usePathname()
  const router = useRouter()

  // One stream for the whole app: every page benefits, and a single connection
  // per tab instead of one per component.
  const { isConnected } = useEventStream()

  // Read-only: shows who is signed in, and lets role-gated controls hide
  // themselves. Authorisation is enforced in every handler, not here.
  const { data: user } = useCurrentUser()

  // F-53: reconcile the rendered palette with the saved one.
  const theme = useThemeSetting()

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/auth/login')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <ThemeSync theme={theme} />
      <aside className="flex shrink-0 flex-col border-b border-slate-800 p-4 md:w-56 md:border-b-0 md:border-r">
        <Link href="/" className="block px-3 py-2 text-sm font-semibold text-slate-200">
          {appName}
        </Link>
        <nav className="mt-4 flex gap-1 overflow-x-auto md:mt-6 md:block md:space-y-1">
          {NAV.map((item) => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'block whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
                ].join(' ')}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="mt-auto space-y-3 px-1 pt-4">
          {user && (
            <div className="border-t border-slate-800 pt-3">
              <p className="truncate text-xs font-medium text-slate-300">
                {user.name || user.email}
              </p>
              <p className="truncate text-[11px] text-slate-500">{user.email}</p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                {user.role}
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span
              className={[
                'h-2 w-2 shrink-0 rounded-full',
                isConnected ? 'bg-emerald-500' : 'bg-slate-600',
              ].join(' ')}
              aria-hidden
            />
            <span className="text-xs text-slate-500">
              {isConnected ? 'Live' : 'Reconnecting…'}
            </span>
          </div>

          <button
            type="button"
            onClick={signOut}
            className="w-full rounded-md px-2 py-1 text-left text-sm text-slate-500 transition-colors hover:bg-slate-900 hover:text-slate-300"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
    </div>
  )
}
