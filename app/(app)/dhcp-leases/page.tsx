'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import Link from 'next/link'

interface DhcpLease {
  id: string
  deviceId: string
  ipAddress: string
  macAddress: string
  hostname: string | null
  leaseStart: string
  leaseEnd: string | null
  isActive: boolean
  createdAt: string
}

async function fetchLeases(): Promise<DhcpLease[]> {
  const res = await fetch('/api/dhcp-leases', { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load DHCP leases')
  const body = (await res.json()) as { data: DhcpLease[] }
  return body.data
}

export default function DhcpLeasesPage() {
  const router = useRouter()
  const [leases, setLeases] = useState<DhcpLease[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    fetchLeases()
      .then(setLeases)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load leases'))
      .finally(() => setIsLoading(false))
  }, [])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await fetch('/api/dhcp-leases/refresh', { method: 'POST' })
      const updated = await fetchLeases()
      setLeases(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        <span className="ml-3 text-slate-400">Loading leases…</span>
      </div>
    )
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">DHCP Leases</h1>
          <p className="mt-1 text-sm text-slate-400">
            Leases observed during network scans. Deactivated when a MAC moves
            to a different IP or goes offline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/devices"
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors rounded-lg hover:bg-slate-800"
          >
            ← Back to devices
          </Link>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-slate-800 text-slate-300 disabled:opacity-50 hover:bg-slate-700 hover:text-slate-100 transition-colors"
          >
            {refreshing ? <RefreshCw className="h-3 w-3 animate-spin mr-2" /> : <RefreshCw className="h-3 w-3 mr-2" />}
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300 mb-6">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-950/50 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/50 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3 text-left">IP Address</th>
              <th className="px-4 py-3 text-left">MAC Address</th>
              <th className="px-4 py-3 text-left">Hostname</th>
              <th className="px-4 py-3 text-left">Lease Start</th>
              <th className="px-4 py-3 text-left">Lease End</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {leases.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                  No active DHCP leases. Run a network scan to populate leases.
                </td>
              </tr>
            ) : (
              leases.map((lease) => (
                <tr key={lease.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-300 whitespace-nowrap">
                    {lease.ipAddress}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300 whitespace-nowrap">
                    {lease.macAddress}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300">
                    {lease.hostname ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                    {new Date(lease.leaseStart).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                    {lease.leaseEnd ? new Date(lease.leaseEnd).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400">
                      Active
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Lease data is derived from scan discovery, not a direct DHCP server
        lease file read. Automatic lease-file parsing is scanner-dependent and
        not yet implemented for the ARP/ASUS backends.
      </p>
    </section>
  )
}
