import { AlertTriangle, Search } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { formatBytes } from '@/lib/utils/format'
import type { DeviceStatus } from '@/lib/types'
import type { DeviceDTO } from '@/lib/api/serialisers'

/**
 * The device list.
 *
 * Presentational only: it owns no query, no pagination and no filters. The
 * page (`app/(app)/devices/page.tsx`) runs the query and hands the result
 * down, which keeps one component per concern and makes the table cheap to
 * reason about — every prop is either data or a callback.
 *
 * ## The light-mode contract
 *
 * `app/globals.css` themes light mode with targeted class overrides rather
 * than CSS variables, and it explains why: a utility is only themed once
 * *every* opacity variant used anywhere in the tree is themed with it. The
 * classes used below were chosen to be ones that file already overrides
 * (surfaces `bg-slate-900/50`, row separators `border-slate-800/50`, badges
 * `bg-green-500/20` and friends, hovers `hover:bg-slate-800`). Adding a new
 * colour here means adding its override there, or light mode silently keeps
 * the dark one.
 */

/**
 * Status colours mirror the detail page so a device reads the same wherever it
 * appears. Row separators use `border-*`, not `divide-*`: Tailwind's divide
 * utilities set border colour from a CSS rule on the parent, which a `.light`
 * class selector cannot reach.
 */
const STATUS_STYLES: Record<DeviceStatus, string> = {
  online: 'bg-green-500/20 text-green-400',
  idle: 'bg-amber-500/15 text-amber-400',
  offline: 'bg-slate-700 text-slate-400',
}

const COLUMNS = [
  'Device',
  'MAC',
  'IP',
  'Type',
  'Status',
  'Signal',
  'Last seen',
  'Bandwidth',
  'Total',
] as const

function StatusBadge({ status }: { status: DeviceStatus }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
        STATUS_STYLES[status],
      )}
    >
      {status}
    </span>
  )
}

export interface DeviceTableProps {
  data: DeviceDTO[]
  isLoading: boolean
  isError: boolean
  error: Error | null
  onRowClick: (device: DeviceDTO) => void
}

export function DeviceTable({
  data,
  isLoading,
  isError,
  error,
  onRowClick,
}: Readonly<DeviceTableProps>) {
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
        <AlertTriangle className="mb-3 h-10 w-10 text-red-400" aria-hidden />
        <p>Failed to load devices</p>
        {error && <p className="mt-1 text-sm text-red-400">{error.message}</p>}
      </div>
    )
  }

  if (isLoading) {
    // Skeleton rows, not a spinner: the page already shows a spinner before
    // the first result set, and replacing the whole table body with one would
    // resize the container on every background refetch.
    return (
      <div className="space-y-3 p-4" role="status" aria-label="Loading devices">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="h-8 animate-pulse rounded bg-slate-800/40" />
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
        <Search className="mb-3 h-10 w-10 text-slate-500" aria-hidden />
        <p>No devices match the current filters.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Discovered network devices</caption>
        <thead className="bg-slate-900/50 text-xs uppercase tracking-wide text-slate-400">
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} scope="col" className="whitespace-nowrap px-4 py-3 text-left font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((device) => {
            // A row is not a link — the target is the detail page, opened by
            // the page's handler so the row itself stays free of routing.
            return (
              <tr
                key={device.id}
                role="button"
                tabIndex={0}
                aria-label={`Open ${device.deviceName || device.hostname || device.macAddress}`}
                onClick={() => onRowClick(device)}
                onKeyDown={(event) => {
                  // Keyboard parity with the click: without it the whole row
                  // is reachable only by pointer.
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onRowClick(device)
                  }
                }}
                className="cursor-pointer border-b border-slate-800/50 transition-colors hover:bg-slate-800"
              >
                <td className="px-4 py-3">
                  <span className="block font-medium text-slate-200">
                    {device.deviceName || device.hostname || 'Unknown device'}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {device.manufacturer || 'Unknown manufacturer'}
                    {device.isBlocked && <span className="text-red-400"> · Blocked</span>}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-300">
                  {device.macAddress}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-300">
                  {device.ipAddress}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-300">{device.deviceType}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StatusBadge status={device.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-300">
                  {device.signalStrength !== null ? `${device.signalStrength} dBm` : '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">
                  {new Date(device.lastSeen).toLocaleString()}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                  <span className="text-blue-400">
                    ↓ {device.currentBandwidth.downloadMbps.toFixed(1)}
                  </span>{' '}
                  <span className="text-emerald-400">
                    ↑ {device.currentBandwidth.uploadMbps.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-500">Mbps</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-300">
                  ↓ {formatBytes(device.totalTransferred.downloadBytes)}
                  <span className="block text-slate-500">
                    ↑ {formatBytes(device.totalTransferred.uploadBytes)}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
