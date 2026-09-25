import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <section className="max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          Home Network Monitor
        </h1>
        <p className="mt-4 text-lg text-slate-400">
          Know what is connected to your network, what it is using, and whether
          it belongs there — all on hardware you control.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/dashboard"
            className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            Open dashboard
          </Link>
          <Link
            href="/api/health"
            className="rounded-md border border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500"
          >
            Health check
          </Link>
        </div>
      </section>
    </main>
  )
}