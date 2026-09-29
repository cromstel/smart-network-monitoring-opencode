'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEventStream } from '@/lib/hooks/useEventStream'

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/overview', label: 'Overview' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/settings', label: 'Settings' },
]

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname()
  const router = useRouter()

  // One stream for the whole app: every page benefits, and a single connection
  // per tab instead of one per component.
  const { isConnected } = useEventStream()

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-slate-800 p-4 md:w-56 md:border-b-0 md:border-r">
        <Link href="/" className="block px-3 py-2 text-sm font-semibold text-slate-200">
          Home Network Monitor
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

        <div className="mt-4 flex items-center gap-2 px-3 md:mt-auto">
          <span
            className={[
              'h-2 w-2 rounded-full',
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
          className="mt-2 rounded-md px-3 py-2 text-left text-sm text-slate-500 transition-colors hover:bg-slate-900 hover:text-slate-300"
        >
          Sign out
        </button>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
    </div>
  )
}
