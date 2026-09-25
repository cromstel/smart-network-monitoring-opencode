export default function DashboardPage() {
  return (
    <section className="mx-auto max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-400">
          Real-time visibility into every device on the network.
        </p>
      </header>

      <div className="mt-8 rounded-lg border border-dashed border-slate-800 p-10 text-center">
        <h2 className="text-lg font-medium text-slate-300">
          No devices yet
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          Devices you connect will appear here with their IP, MAC address,
          vendor, and bandwidth as soon as scanning starts. Enable the scanner
          and run migrations with{' '}
          <code className="rounded bg-slate-900 px-1.5 py-0.5 text-xs text-slate-300">
            npm run db:migrate
          </code>{' '}
          to begin.
        </p>
      </div>
    </section>
  )
}