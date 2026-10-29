import type { ScanSummary } from '@/lib/db/repositories/scanHistoryRepository'

/**
 * Wording for the daily scan summary.
 *
 * Deliberately its own module: `scanSummaryJob` runtime-imports
 * `scanHistoryRepository`, which runtime-imports `lib/db/client`, which
 * throws at import time when no database is configured. Keeping the formatter
 * here with nothing but a type-level import (erased at compile time) lets a
 * test assert the exact wording an admin will read on a machine with no
 * database — the human-readable text is the deliverable of the summary, and
 * it should be testable without infrastructure.
 */
export function buildSummaryMessage(summary: ScanSummary): string {
  const scanner = summary.scannerName ? ` (${summary.scannerName})` : ''
  const lines = [
    `In the last 24 hours: ${summary.totalScans} scan${summary.totalScans === 1 ? '' : 's'} completed${scanner}.`,
    `Success: ${summary.successCount}, partial: ${summary.partialCount}, failed: ${summary.failedCount}.`,
    `Devices seen at peak: ${summary.maxDevicesSeen}. Average scan duration: ${summary.avgDurationMs}ms.`,
  ]
  return lines.join(' ')
}
