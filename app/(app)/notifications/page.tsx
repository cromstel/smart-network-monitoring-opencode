import Link from 'next/link'
import { headers } from 'next/headers'

interface NotificationItem {
  id: string
  title: string
  message: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  isRead: boolean
  createdAt: string
}

async function fetchNotifications(): Promise<NotificationItem[]> {
  const h = await headers()
  const host = h.get('host') || 'localhost:9090'
  const protocol = h.get('x-forwarded-proto') || 'http'
  const baseUrl = `${protocol}://${host}`

  try {
    const res = await fetch(`${baseUrl}/api/notifications`, {
      cache: 'no-store',
      headers: { cookie: h.get('cookie') || '' },
    })
    if (!res.ok) return []
    const body = (await res.json()) as {
      data?: { notifications?: NotificationItem[] }
    }
    return body.data?.notifications ?? []
  } catch {
    return []
  }
}

export default async function NotificationsPage() {
  const notifications = await fetchNotifications()

  return (
    <main className="px-4 py-6 md:py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
          Notifications
        </h1>
        <Link
          href="/"
          className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
        >
          Back to dashboard
        </Link>
      </div>

      {notifications.length === 0 ? (
        <p className="text-sm text-slate-500">No notifications yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800 space-y-3">
          {notifications.map((n) => (
            <li key={n.id}>
              <article
                className="rounded-none bg-white dark:bg-slate-950 p-5 shadow-sm border border-slate-100 dark:border-slate-900"
              >
                <h2 className="font-semibold text-slate-800 dark:text-slate-100">
                  {n.title}
                </h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {n.message}
                </p>
                <p className="mt-2 text-xs font-medium text-slate-400 uppercase tracking-wide">
                  {n.priority}
                </p>
                <time className="mt-1 block text-xs text-slate-400">
                  {new Date(n.createdAt).toLocaleString()}
                </time>
                {!n.isRead && (
                  <span className="mt-2 inline-block px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px] font-semibold">
                    Unread
                  </span>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
