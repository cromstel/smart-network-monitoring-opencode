'use client'

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
            <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/50 p-6 animate-pulse">
              <div className="h-4 bg-slate-800 rounded w-1/2 mb-2" />
              <div className="h-8 bg-slate-800 rounded w-3/4" />
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
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} stroke="#334155" />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} stroke="#334155" tickFormatter={(v) => `${v} Mbps`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: '#f1f5f9' }}
                  itemStyle={{ color: '#f1f5f9' }}
                  formatter={(v: any) => [`${(v ?? 0).toFixed(2)} Mbps`, '']}
                />
                <Legend />
                <Bar dataKey="value" fill="#3b82f6" name="Download" radius={[4, 4, 0, 0]} />
                <Bar dataKey="value" fill="#22c55e" name="Upload" radius={[4, 4, 0, 0]} />
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
                      <span className="text-blue-400">↓ {consumer.downloadMbps.toFixed(1)}</span>
                      <span className="mx-2 text-amber-400">↑ {consumer.uploadMbps.toFixed(1)}</span>
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
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} stroke="#334155" />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} stroke="#334155" tickFormatter={(v) => `${v} Mbps`} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#f1f5f9' }}
                itemStyle={{ color: '#f1f5f9' }}
                formatter={(v: any) => [`${(v ?? 0).toFixed(2)} Mbps`, '']}
              />
              <Legend />
              <Bar dataKey="value" fill="#3b82f6" name="Download" radius={[4, 4, 0, 0]} />
              <Bar dataKey="value" fill="#22c55e" name="Upload" radius={[4, 4, 0, 0]} />
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
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-400">{label}</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
          {subLabel && <p className="mt-1 text-sm text-slate-500">{subLabel}</p>}
        </div>
        <div className="p-3 rounded-lg bg-slate-800/50">{icon}</div>
      </div>
    </div>
  )
}