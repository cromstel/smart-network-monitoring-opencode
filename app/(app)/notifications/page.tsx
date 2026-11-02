import Link from 'next/link'
import { headers } from 'next/headers'

export default async function NotificationsPage() {
  const h = await headers()
  const host = h.get('host') || 'localhost:9090'
  const protocol = h.get('x-forwarded-proto') || 'http'
  const baseUrl = `${protocol}://${host}`
  const res = await fetch(`${baseUrl}/api/notifications`, { cache: 'no-store', headers: { cookie: h.get('cookie') || '' } })
  const notifications = res.ok ? (await res.json()).data ?? [] : [
    { id: '1', title: 'New device detected', message: 'Device 192.168.1.42 joined the network.', time: '2 min ago' },
    { id: '2', title: 'Scan completed', message: 'Network scan finished: 12 devices found.', time: '15 min ago' },
    { id: '3', title: 'Firewall blocked', message: '3 unauthorized connection attempts blocked.', time: '1 hr ago' },
  ]

  return (
    <main className="px-4 py-6 md:py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">Notifications</h1>
        <Link href="/" className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100">Back to dashboard</Link>
      </div>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800 space-y-3">
        {notifications.map((n: any) => (
          <li key={n.id}>
            <article className="rounded-none bg-white dark:bg-slate-950 p-5 shadow-sm border border-slate-100 dark:border-slate-900">
              <h2 className="font-semibold text-slate-800 dark:text-slate-100">{n.title}</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{n.message}</p>
              <time className="mt-3 block text-xs text-slate-400">{n.time}</time>
            </article>
          </li>
        ))}
      </ul>
    </main>
  )
}
