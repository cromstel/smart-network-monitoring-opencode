'use client'

import { useState, useMemo, useCallback } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@radix-ui/react-select'
import { Search, ChevronUp, ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { DeviceDTO } from '@/lib/api/serialisers'

interface DeviceTableProps {
  data: DeviceDTO[]
  isLoading?: boolean
  isError?: boolean
  error?: Error | null
  onRowClick?: (device: DeviceDTO) => void
}

// Sort keys are DTO field names plus the two bandwidth columns, which live
// under currentBandwidth rather than at the top level.
type SortField = keyof DeviceDTO | 'download' | 'upload'
type SortDirection = 'asc' | 'desc'

function getDeviceValue(device: DeviceDTO, field: SortField): string | number {
  if (field === 'download' || field === 'upload') {
    return field === 'download' ? device.currentBandwidth.downloadMbps : device.currentBandwidth.uploadMbps
  }
  const value = device[field]
  // lastSeen/firstSeen are ISO strings; everything else is a scalar.
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return ''
  return value as string | number
}

function compareValues(a: string | number, b: string | number, direction: SortDirection): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return direction === 'asc' ? a - b : b - a
  }
  const aStr = String(a).toLowerCase()
  const bStr = String(b).toLowerCase()
  return direction === 'asc'
    ? aStr.localeCompare(bStr)
    : bStr.localeCompare(aStr)
}

const columns = [
  { id: 'mac', header: 'MAC Address', accessor: 'macAddress', size: 160 },
  { id: 'ip', header: 'IP Address', accessor: 'ipAddress', size: 130 },
  { id: 'name', header: 'Name', accessor: 'deviceName', size: 180 },
  { id: 'type', header: 'Type', accessor: 'deviceType', size: 100 },
  { id: 'manufacturer', header: 'Manufacturer', accessor: 'manufacturer', size: 150 },
  { id: 'download', header: 'Download', accessor: 'download', size: 120 },
  { id: 'upload', header: 'Upload', accessor: 'upload', size: 100 },
  { id: 'status', header: 'Status', accessor: 'status', size: 90 },
  { id: 'lastSeen', header: 'Last Seen', accessor: 'lastSeen', size: 180 },
] as const

export function DeviceTable({
  data,
  isLoading = false,
  isError = false,
  error,
  onRowClick,
}: DeviceTableProps) {
  const [sortField, setSortField] = useState<SortField>('lastSeen')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [globalFilter, setGlobalFilter] = useState('')
  const [pageSize, setPageSize] = useState(25)
  const [pageIndex, setPageIndex] = useState(0)

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortDirection('asc')
      }
      return field
    })
  }, [])

  const filteredData = useMemo(() => {
    let result = [...data]

    if (globalFilter) {
      const filter = globalFilter.toLowerCase()
      result = result.filter(
        (device) =>
          device.macAddress.toLowerCase().includes(filter) ||
          device.ipAddress.toLowerCase().includes(filter) ||
          (device.deviceName || '').toLowerCase().includes(filter) ||
          device.deviceType.toLowerCase().includes(filter) ||
          (device.manufacturer || '').toLowerCase().includes(filter)
      )
    }

    result.sort((a, b) => {
      const aVal = getDeviceValue(a, sortField)
      const bVal = getDeviceValue(b, sortField)
      return compareValues(aVal, bVal, sortDirection)
    })

    return result
  }, [data, globalFilter, sortField, sortDirection])

  const totalPages = Math.ceil(filteredData.length / pageSize)
  const paginatedData = useMemo(
    () => filteredData.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize),
    [filteredData, pageIndex, pageSize]
  )

  if (isLoading) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              {columns.map((col) => (
                <th key={col.id} className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-slate-800/50">
                {columns.map((col) => (
                  <td key={col.id} className="px-4 py-4">
                    <div className="h-4 bg-slate-800/50 rounded animate-pulse w-3/4" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p>Failed to load devices</p>
        {error && <p className="text-sm text-red-400 mt-2">{error.message}</p>}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p>No devices found</p>
      </div>
    )
  }

  const renderCell = (device: DeviceDTO, column: { accessor: string; id: string }) => {
    const accessor = column.accessor as string
    if (accessor === 'download' || accessor === 'upload') {
      const speed =
        accessor === 'download' ? device.currentBandwidth.downloadMbps : device.currentBandwidth.uploadMbps
      if (speed === null || speed === undefined) return '—'
      return `${Number(speed).toFixed(2)} Mbps`
    }
    if (accessor === 'status') {
      const status = device.status
      return (
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
            status === 'online'
              ? 'bg-green-500/20 text-green-400'
              : 'bg-slate-700 text-slate-400'
          )}
        >
          {status}
        </span>
      )
    }
    if (accessor === 'deviceName') {
      return device.deviceName || '—'
    }
    if (accessor === 'manufacturer') {
      return device.manufacturer || 'Unknown'
    }
    if (accessor === 'deviceType') {
      const type = device.deviceType
      return (
        <span className="inline-flex items-center rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-300">
          {type}
        </span>
      )
    }
    if (accessor === 'lastSeen') {
      const date = device.lastSeen
      if (!date) return '—'
      return new Date(date).toLocaleString()
    }
    // For simple accessors
    const value = (device as unknown as Record<string, unknown>)[accessor]
    return value ?? '—'
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative max-w-xs w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 h-4 w-4" />
          <input
            type="text"
            aria-label="Filter the rows on this page"
            placeholder="Filter this page"
            value={globalFilter}
            onChange={(e) => {
              setGlobalFilter(e.target.value)
              setPageIndex(0)
            }}
            className="w-full pl-10 pr-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400">Rows per page:</label>
          <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(Number(v)); setPageIndex(0); }}>
            <SelectTrigger className="w-[120px] bg-slate-800/50 border border-slate-700">
              <SelectValue placeholder="25" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full">
          <thead className="bg-slate-900/50">
            <tr className="border-b border-slate-800">
              {columns.map((col) => (
                <th
                  key={col.id}
                  className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-200 select-none"
                  onClick={() => handleSort(col.accessor as SortField)}
                  style={{ width: col.size }}
                >
                  <div className="flex items-center gap-1">
                    {col.header}
                    {sortField === col.accessor && (
                      sortDirection === 'asc' ? (
                        <ChevronUp className="h-4 w-4 text-blue-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-blue-400" />
                      )
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {paginatedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-400">
                  No matching devices
                </td>
              </tr>
            ) : (
              paginatedData.map((device) => (
                <tr
                  key={device.id}
                  className={cn(
                    'transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-slate-800/50'
                  )}
                  onClick={() => onRowClick?.(device)}
                >
                  {columns.map((col) => (
                    <td key={col.id} className="px-4 py-3 text-sm text-slate-300">
                      {renderCell(device, col) as React.ReactNode}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">
          Showing{' '}
          <span className="font-medium">{pageIndex * pageSize + 1}</span>
          {' to '}
          <span className="font-medium">
            {Math.min((pageIndex + 1) * pageSize, filteredData.length)}
          </span>
          {' of '}
          <span className="font-medium">{filteredData.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
            disabled={pageIndex === 0}
            className="px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <button
            onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
            disabled={pageIndex >= totalPages - 1}
            className="px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}