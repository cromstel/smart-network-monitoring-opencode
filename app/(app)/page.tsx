'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Wifi, TrendingUp, Download, Upload } from 'lucide-react'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'

interface OverviewData {
  totals: {
    totalDevices: number
    onlineDevices: number
    totalUploadMbps: number
    totalDownloadMbps: number
  }
  peak: {
    peakUploadMbps: number
    peakDownloadMbps: number
  }
  topConsumers: Array<{
    deviceId: string
    deviceName: string | null
    macAddress: string
    ipAddress: string
    totalMbps: number
    uploadMbps: number
    downloadMbps: number
  }>
}

export default function OverviewPage() {
  const [headerOpen, setHeaderOpen] = useState(false)
  const { data: userData } = useCurrentUser()
  const user = userData ?? null
  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.reload()
  }

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['overview'],
    queryFn: async () => {
      const res = await fetch('/api/overview')
      if (!res.ok) throw new Error('Failed to fetch overview')
      return res.json() as Promise<{ data: OverviewData }>
    },
    staleTime: 5_000,
    refetchInterval: 5_000,
  })

  const totals = data?.data?.totals
  const peak = data?.data?.peak
  const topConsumers = data?.data?.topConsumers

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 p-6 animate-pulse">
              <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/2 mb-2" />
              <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded w-3/4" />
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-6 animate-pulse">
          <div className="h-8 bg-slate-800 rounded w-1/2 mb-4" />
          <div className="h-64 bg-slate-800 rounded" />
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-6 animate-pulse">
          <div className="h-8 bg-slate-800 rounded w-1/2 mb-4" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-slate-800 rounded" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-400">
        <p>Failed to load overview</p>
        {error && <p className="text-sm text-red-400 mt-2">{error.message}</p>}
      </div>
    )
  }

  if (!totals) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p>No data available</p>
      </div>
    )
  }

  const totalThroughput = totals.totalUploadMbps + totals.totalDownloadMbps
  const peakThroughput = (peak?.peakUploadMbps ?? 0) + (peak?.peakDownloadMbps ?? 0)

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="text-xs text-slate-500 dark:text-slate-400 font-medium tracking-wide">Dashboard / Overview</div>
        <div className="flex items-center gap-3 flex-1 justify-end">
          <div className="relative max-w-xs w-full">
            <input
              type="text"
              placeholder="Search..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>
          <button aria-label="Notifications" className="relative rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-950" />
          </button>
          {user && (
            <div className="relative">
              <button onClick={() => setHeaderOpen((v) => !v)} className="flex items-center gap-2 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700" aria-expanded={headerOpen} aria-haspopup="true">
                <span className="truncate max-w-[120px]">{user.name || user.email}</span>
                <span className="text-[10px] text-slate-500">{user.role}</span>
              </button>
              {headerOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-2 z-20">
                  <div className="px-2 py-1 text-xs font-medium text-slate-900 dark:text-slate-100 truncate">{user.name || user.email}</div>
                  <div className="px-2 py-0.5 text-[10px] text-slate-500 truncate">{user.email}</div>
                  <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                  <button onClick={() => { setHeaderOpen(false); signOut(); }} className="w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Sign out</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-slate-400">
            Real-time visibility into your network.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={<Wifi className="h-5 w-5 text-emerald-500" />}
          label="Devices"
          value={`${totals.onlineDevices} / ${totals.totalDevices}`}
          subLabel={`${totals.onlineDevices} online`}
        />
        <StatCard
          icon={<Download className="h-5 w-5 text-blue-500" />}
          label="Download"
          value={`${totals.totalDownloadMbps.toFixed(1)} Mbps`}
          subLabel="Current throughput"
        />
        <StatCard
          icon={<Upload className="h-5 w-5 text-amber-500" />}
          label="Upload"
          value={`${totals.totalUploadMbps.toFixed(1)} Mbps`}
          subLabel="Current throughput"
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5 text-red-500" />}
          label="Total Throughput"
          value={`${totalThroughput.toFixed(1)} Mbps`}
          subLabel={`Today's peak: ${peakThroughput.toFixed(1)} Mbps`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-6">
          <h2 className="text-lg font-medium mb-4">Today's Peak Throughput</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[{ name: 'Download', value: peak?.peakDownloadMbps ?? 0 }, { name: 'Upload', value: peak?.peakUploadMbps ?? 0 }]}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="name" tick={{ fill: 'var(--chart-tick)', fontSize: 12 }} stroke="var(--chart-grid)" />
                <YAxis tick={{ fill: 'var(--chart-tick)', fontSize: 12 }} stroke="var(--chart-grid)" tickFormatter={(v) => `${v} Mbps`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--chart-tooltip-bg)',
                    border: '1px solid var(--chart-grid)',
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: 'var(--chart-tooltip-fg)' }}
                  itemStyle={{ color: 'var(--chart-tooltip-fg)' }}
                  formatter={(v: any) => [`${(v ?? 0).toFixed(2)} Mbps`, '']}
                />
                <Legend />
                <Bar dataKey="value" fill="var(--chart-download)" name="Download" radius={[4, 4, 0, 0]} />
                <Bar dataKey="value" fill="var(--chart-upload)" name="Upload" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-6">
          <h2 className="text-lg font-medium mb-4">Top 5 Bandwidth Consumers</h2>
          {topConsumers && topConsumers.length > 0 ? (
            <div className="space-y-3">
              {topConsumers.map((consumer, index) => (
                <div key={consumer.deviceId} className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-slate-500 text-sm font-mono">{index + 1}.</span>
                    <div className="min-w-0">
                      <p className="text-slate-100 truncate font-medium">
                        {consumer.deviceName || consumer.macAddress}
                      </p>
                      <p className="text-slate-500 text-xs truncate">{consumer.ipAddress}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div className="text-xs text-slate-400">
                      <span className="text-blue-400">â†“ {consumer.downloadMbps.toFixed(1)}</span>
                      <span className="mx-2 text-amber-400">â†‘ {consumer.uploadMbps.toFixed(1)}</span>
                    </div>
                    <div className="text-slate-100 font-medium text-sm">
                      {consumer.totalMbps.toFixed(1)} Mbps
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-400 text-center py-8">No bandwidth data available</p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-6">
        <h2 className="text-lg font-medium mb-4">Current Network Throughput</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[{ name: 'Download', value: totals.totalDownloadMbps }, { name: 'Upload', value: totals.totalUploadMbps }]}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="name" tick={{ fill: 'var(--chart-tick)', fontSize: 12 }} stroke="var(--chart-grid)" />
              <YAxis tick={{ fill: 'var(--chart-tick)', fontSize: 12 }} stroke="var(--chart-grid)" tickFormatter={(v) => `${v} Mbps`} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--chart-tooltip-bg)',
                  border: '1px solid var(--chart-grid)',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: 'var(--chart-tooltip-fg)' }}
                itemStyle={{ color: 'var(--chart-tooltip-fg)' }}
                formatter={(v: any) => [`${(v ?? 0).toFixed(2)} Mbps`, '']}
              />
              <Legend />
              <Bar dataKey="value" fill="var(--chart-download)" name="Download" radius={[4, 4, 0, 0]} />
              <Bar dataKey="value" fill="var(--chart-upload)" name="Upload" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  )
}

function StatCard({
  icon,
  label,
  value,
  subLabel,
}: {
  icon: React.ReactNode
  label: string
  value: string
  subLabel?: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-base text-slate-800 dark:text-slate-100 font-medium">{label}</p>
          <p className="mt-1 text-lg md:text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            {value.includes(' Mbps') ? (
              <>
                <span className="text-lg md:text-xl">{value.replace(' Mbps', '')}</span> <span className="text-xs font-medium opacity-70">Mbps</span>
              </>
            ) : (
              <span className="text-lg md:text-xl">{value}</span>
            )}
          </p>
          {subLabel && <p className="mt-1 text-sm text-slate-800 dark:text-slate-100 whitespace-nowrap">{subLabel}</p>}
        </div>
        <div>{icon}</div>
      </div>
    </div>
  )
}