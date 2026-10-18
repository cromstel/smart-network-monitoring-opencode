import Link from 'next/link'

/** Rendered for any unmatched route — `not-found.tsx` at the root so 404s from
 *  the proxy and from the server both land on it rather than on Next's default. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="max-w-md text-sm text-slate-400">
        That page does not exist. The link may be out of date, or the address may
        have been mistyped.
      </p>
      <Link
        href="/"
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
      >
        Back to overview
      </Link>
    </main>
  )
}
