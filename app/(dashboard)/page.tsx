'use client'

import { useState } from 'react'
import { useDevices } from '@/lib/hooks/useDevices'
import { DeviceTable } from '@/components/DeviceTable'
import { Loader2 } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@radix-ui/react-select'
import { ChevronUp, ChevronDown } from 'lucide-react'
import type { DeviceDTO } from '@/lib/api/serialisers'

export default function DashboardPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string>('')
  const [sort, setSort] = useState<string>('lastSeen')
  const [order, setOrder] = useState<string>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const { data, isLoading, isError, error } = useDevices({
    page,
    pageSize,
    search,
    status: (status || undefined) as 'online' | 'offline' | 'idle' | undefined,
    sort: sort as 'name' | 'lastSeen' | 'bandwidth' | undefined,
    order: order as 'asc' | 'desc' | undefined,
  })

  const handleRowClick = (device: DeviceDTO) => {
    window.location.href = `/devices/${device.id}`
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Devices</h1>
        <p className="mt-1 text-sm text-slate-400">
          Real-time visibility into every device on the network.
        </p>
      </header>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            placeholder="Search devices..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[160px] bg-slate-800/50 border border-slate-700">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All statuses</SelectItem>
              <SelectItem value="online">Online</SelectItem>
              <SelectItem value="offline">Offline</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-[160px] bg-slate-800/50 border border-slate-700">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lastSeen">Last Seen</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="bandwidth">Bandwidth</SelectItem>
            </SelectContent>
          </Select>
          <Select value={order} onValueChange={setOrder}>
            <SelectTrigger className="w-[120px] bg-slate-800/50 border border-slate-700">
              <SelectValue placeholder="Order" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">
                <ChevronUp className="h-4 w-4 mr-2" /> Ascending
              </SelectItem>
              <SelectItem value="desc">
                <ChevronDown className="h-4 w-4 mr-2" /> Descending
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/50">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
            <span className="ml-3 text-slate-400">Loading devices...</span>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <p>Failed to load devices</p>
            {error && <p className="text-sm text-red-400 mt-2">{error.message}</p>}
          </div>
        ) : (
          <DeviceTable
            data={data || []}
            isLoading={isLoading}
            isError={isError}
            error={error}
            onRowClick={handleRowClick}
          />
        )}
      </div>
    </section>
  )
}