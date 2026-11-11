'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

interface AuditLog {
  id: string
  userId: string
  action: string
  resourceType: string
  resourceId: string | null
  oldValues: string | null
  newValues: string | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
}

async function fetchAuditLogs(params?: URLSearchParams): Promise<{ data: AuditLog[]; total: number }> {
  const searchParams = params ?? new URLSearchParams()
  const res = await fetch(`/api/audit-logs?${searchParams.toString()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load audit logs')
  return res.json()
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(25)
  const [offset, setOffset] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState('')

  useEffect(() => {
    const params = new URLSearchParams()
    params.set('limit', limit.toString())
    params.set('offset', offset.toString())
    if (actionFilter) params.set('action', actionFilter)

    fetchAuditLogs(params)
      .then(({ data, total: totalCount }) => {
        setLogs(data)
        setTotal(totalCount)
        setIsLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load audit logs')
        setIsLoading(false)
      })
  }, [limit, offset, actionFilter])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        <span className="ml-3 text-slate-400">Loading audit logs…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-400">
        <p>{error}</p>
        <Link
          href="/alerts"
          className="mt-4 px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors rounded-lg hover:bg-slate-800"
        >
          ← Back to Alerts
        </Link>
      </div>
    )
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Audit Log</h1>
          <p className="mt-1 text-sm text-slate-400">
            Administrative actions for security and accountability.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/alerts"
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors rounded-lg hover:bg-slate-800"
          >
            ← Back to Alerts
          </Link>
        </div>
      </header>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            placeholder="Filter by action (e.g. device_blocked, settings_changed)"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/50 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/50 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Time</th>
              <th className="px-4 py-3 text-left font-medium">Action</th>
              <th className="px-4 py-3 text-left font-medium">Resource</th>
              <th className="px-4 py-3 text-left font-medium">Resource ID</th>
              <th className="px-4 py-3 text-left font-medium">User</th>
              <th className="px-4 py-3 text-left font-medium">IP Address</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                  No audit log entries.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3 text-xs text-slate-400 font-mono whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-200 font-mono">
                    {log.action}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300 font-mono whitespace-nowrap">
                    {log.resourceType}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300 font-mono whitespace-nowrap">
                    {log.resourceId ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300 font-mono whitespace-nowrap">
                    {log.userId}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 font-mono whitespace-nowrap">
                    {log.ipAddress ?? '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {logs.length > 0 && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Showing {offset + 1}–{Math.min(offset + limit, total)} of {total} entries
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOffset((o) => Math.max(o - limit, 0))}
              disabled={offset === 0}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 bg-slate-800 text-slate-300 disabled:opacity-50 disabled:pointer-events-none hover:bg-slate-700"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setOffset((o) => o + limit)}
              disabled={offset + limit >= total}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 bg-slate-800 text-slate-300 disabled:opacity-50 disabled:pointer-events-none hover:bg-slate-700"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
