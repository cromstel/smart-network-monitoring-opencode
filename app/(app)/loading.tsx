/** Suspense fallback for the authenticated shell — shown while a segment that
 *  is not behind its own loading file streams in. */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" role="status" aria-label="Loading">
      <div className="h-8 w-48 rounded bg-slate-800" />
      <div className="grid gap-6 lg:grid-cols-3">
        {[0, 1, 2].map((column) => (
          <div key={column} className="h-40 rounded-lg bg-slate-900" />
        ))}
      </div>
      <div className="h-64 rounded-lg bg-slate-900" />
    </div>
  )
}
