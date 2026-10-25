'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'

/**
 * The React Query provider for the whole app.
 *
 * ## Why 'use client' — and why this file must not be a server component
 *
 * `QueryClientProvider`'s `client` prop is a `QueryClient`, and a `QueryClient`
 * is a *class instance*. React cannot serialise a class instance across the
 * server→client boundary: it throws
 *
 *   "Only plain objects, and a few built-ins, can be passed to Client
 *    Components from Server Components. Classes or null prototypes are not
 *    supported."
 *
 * with the failing prop shown as `<... client={{}} ...>`, which reads like a
 * Providers bug but is really a boundary rule. The first version of this file
 * had no directive, so the import of the singleton made it a server component
 * and the very first render of `/auth/login` failed with exactly that error.
 * The directive moves the module into the client graph, where the instance is
 * passed by reference and never serialised.
 *
 * The cost: `children` arrive as a prop from the server layout. That is the
 * supported pattern — server-rendered children of a client component stay
 * server-rendered; only this provider is client JS.
 *
 * ## Why the singleton, and not a per-render client
 *
 * `lib/hooks/useEventStream` calls `queryClient.invalidateQueries(...)` on the
 * module singleton directly — it can, because it runs in effects outside
 * React's render. That is only correct when the provider's client *is* that
 * singleton: in the browser it is, so an invalidation from the stream and a
 * `useQuery` from a page address the same cache. A per-mount client created
 * here would give two different caches, and an event-stream invalidation would
 * be silently dropped — the same class of bug the shared `['settings']` key
 * documents in `DashboardShell`.
 *
 * On the server the singleton is shared, which is safe here only because
 * nothing server-rendered queries through it: every consumer is a client
 * component, and React Query does not fetch during SSR. If a server component
 * ever needs its own client, create it per request — do not reuse this one.
 */
export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
