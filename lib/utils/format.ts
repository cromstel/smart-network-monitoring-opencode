const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'] as const

/**
 * Formats a byte count for display using binary units and one decimal place
 * above 1 KB. Accepts a string because MySQL reads BIGINT counters as strings
 * that can exceed Number.MAX_SAFE_INTEGER (AUDIT.md A-05).
 */
export function formatBytes(value: string | number): string {
  const bytes = typeof value === 'number' ? BigInt(Math.trunc(value)) : BigInt(value)
  if (bytes < 0n) throw new Error(`formatBytes: negative byte count ${bytes}`)
  if (bytes < 1024n) return `${bytes.toString()} B`

  let unit = 0
  let tenths = 0n
  for (let i = 1; i < UNITS.length; i++) {
    if (bytes < 1024n ** BigInt(i + 1)) {
      unit = i
      tenths = (bytes * 10n) / 1024n ** BigInt(i)
      break
    }
  }
  return `${(tenths / 10n).toString()}.${(tenths % 10n).toString()} ${UNITS[unit]}`
}

export function formatUptime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const days = Math.floor(safe / 86400)
  const hours = Math.floor((safe % 86400) / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}