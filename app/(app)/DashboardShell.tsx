'use client'

import Link from 'next/link'
import { useState } from 'react'
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
// than reusing the word Dashboard for both. Firewall sits with the actions
// rather than the inventory: it is the page where devices get blocked.
const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/devices', label: 'Devices' },
  { href: '/firewall', label: 'Firewall' },
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

  const [userOpen, setUserOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [notOpen, setNotOpen] = useState(false)
  const [headerOpen, setHeaderOpen] = useState(false)

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/auth/login')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <ThemeSync theme={theme} />
      <aside className="flex shrink-0 flex-col border-b border-slate-200 dark:border-slate-800 p-4 md:w-56 md:border-b-0 md:border-r">
        <Link href="/" className="flex items-center gap-2 px-3 py-2">
          <img src="/logo.avif" alt="" className="h-9 w-9 rounded-md object-contain" aria-hidden />
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-200">
            <span className="block font-bold uppercase">Smart Home</span>
            <span className="block">Network Monitor</span>
          </span>
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
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-slate-200',
                ].join(' ')}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="mt-auto space-y-3 px-1 pt-4">
          {user && (
            <div className="relative border-t border-slate-200 dark:border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setUserOpen((v) => !v)}
                className="flex w-full items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-200"
                aria-expanded={userOpen}
                aria-haspopup="true"
              >
                <span className="truncate">{user.name || user.email}</span>
                <span className="ml-auto text-[10px]">{user.role}</span>
              </button>
              {userOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-48 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-2 z-10">
                  <div className="px-2 py-1 text-xs font-medium text-slate-900 dark:text-slate-100 truncate">{user.name || user.email}</div>
                  <div className="px-2 py-0.5 text-[10px] text-slate-500 dark:text-slate-400 truncate">{user.email}</div>
                  <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                  <button
                    type="button"
                    onClick={() => { setUserOpen(false); signOut(); }}
                    className="w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >Sign out</button>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <span
              className={[
                'h-2 w-2 shrink-0 rounded-full',
                isConnected ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600',
              ].join(' ')}
              aria-hidden
            />
            <span className="text-xs text-slate-600 dark:text-slate-500">
              {isConnected ? 'Live' : 'Reconnecting…'}
            </span>
          </div>

        </div>
      </aside>
      <div className="min-w-0 flex-1 p-4 md:p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="relative max-w-md w-full">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search devices, alerts, network..."
              className="w-full rounded-none border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>
          <div className="flex items-center gap-3 flex-1 justify-end">
            <div className="relative">
              <button onClick={() => setNotOpen(v => !v)} aria-label="Notifications" className="relative rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300" aria-expanded={notOpen} aria-haspopup="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
                <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-950" />
              </button>
              {notOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-3 z-30">
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">Notifications</p>
                  <div className="space-y-2">
                    <div className="rounded-md bg-slate-50 dark:bg-slate-800 px-2 py-2 text-xs text-slate-700 dark:text-slate-300">New device detected</div>
                    <div className="rounded-md bg-slate-50 dark:bg-slate-800 px-2 py-2 text-xs text-slate-700 dark:text-slate-300">Scan completed: 12 devices</div>
                    <div className="rounded-md bg-slate-50 dark:bg-slate-800 px-2 py-2 text-xs text-slate-700 dark:text-slate-300">Firewall: blocked 3 attempts</div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <Link href="/notifications" className="block rounded-md px-2 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">View all notifications</Link>
                  </div>
                </div>
              )}
            </div>
            {user && (
              <div className="relative">
                <button onClick={() => setHeaderOpen(v => !v)} className="flex items-center gap-2 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700" aria-expanded={headerOpen} aria-haspopup="true">
                  <span className="truncate max-w-[120px]">{user.name || user.email}</span>
                </button>
                {headerOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-2 z-20">
                    <div className="px-2 py-1 text-xs font-medium text-slate-900 dark:text-slate-100 truncate">{user.name || user.email}</div>
                    <div className="px-2 py-0.5 text-[10px] text-slate-500 truncate">{user.email}</div>
                    <div className="px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400 truncate uppercase tracking-wide">{user.role}</div>
                    <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                    <a href="/" className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Profile</a>
                    <a href="/settings" className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Settings</a>
                    <a href="/admin/devices" className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Admin</a>
                    <button onClick={() => { setHeaderOpen(false); signOut(); }} className="w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Sign out</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="mt-2 mb-2 border-t border-slate-200 dark:border-slate-800" />
        {children}
      </div>
    </div>
  )
}
