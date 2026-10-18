'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'

/**
 * `digest` is attached by Next to errors crossing a Server Component boundary,
 * but it is not part of the `Error` type — read it structurally so the boundary
 * neither crashes on a Client Component error nor has to lie to the compiler.
 */
function readDigest(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const { digest } = error as { digest?: unknown }
  return typeof digest === 'string' ? digest : undefined
}

/**
 * Route-segment error boundary for the authenticated shell.
 *
 * Next 16 renames the recovery callback from `reset` to `retry`, and narrows
 * the `error` prop to `unknown` — it is an `Error` when it crossed a Server
 * Component boundary, but a Client Component can throw anything, so it is
 * narrowed with `instanceof Error` before `message` is read.
 *
 * The component is named `ErrorBoundary`, not `Error`: a component called
 * `Error` shadows the global constructor in module scope, which makes
 * `error instanceof Error` compare against the component function and stops
 * narrowing entirely.
 *
 * In production the server-side message is replaced by a generic sentence and
 * `digest`, which matches this line in the server log; the digest is surfaced
 * so an operator can actually correlate them.
 */
export default function ErrorBoundary({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  const message =
    error instanceof Error && error.message ? error.message : 'Something went wrong.'
  const digest = readDigest(error)

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-red-400">
        Something went wrong
      </p>
      <p className="max-w-xl text-sm text-slate-400">{message}</p>
      {digest && (
        <p className="text-xs text-slate-600" title="Match this against the server log.">
          Reference: {digest}
        </p>
      )}
      <button
        type="button"
        onClick={() => retry()}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
      >
        Try again
      </button>
    </div>
  )
}
