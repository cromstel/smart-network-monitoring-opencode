import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/components/Providers'
import { ThemeScript } from '@/components/ThemeScript'
import { appName } from '@/lib/config/app'

/**
 * Rendered per request, never prerendered.
 *
 * `APP_NAME` is deployment configuration, and the whole point of reading it on
 * the server is that one image can serve several white-labelled deployments.
 * Without this, Next.js prerenders every route that only reads the name — the
 * build output showed `/auth/login`, `/auth/setup`, `/` and `/_not-found` all
 * as `"compute":"static"` — and `next start` then serves that baked HTML. The
 * variable is read at request time and *still* has no effect, which is worse
 * than not reading it: the configured name appears to be ignored for reasons
 * nothing in the startup logs explains.
 *
 * Observed: a build with `APP_NAME=Home Network Monitor` followed by a server
 * started with `APP_NAME=Acme Verify Name` returned `<title>Home Network
 * Monitor</title>`. Forcing dynamic rendering is what closes that gap.
 *
 * The cost is one server render per page view. The authenticated shell was
 * already per-request in production — it streams a live event connection and
 * the API routes read the session cookie — but the public pages were not:
 * `/auth/login`, `/auth/setup` and `/_not-found` were prerendered and are now
 * rendered per request. For a home-network tool the traffic cannot justify
 * keeping them static in one build, and a stale title is worse than a slightly
 * more expensive login page.
 */
export const dynamic = 'force-dynamic'

/**
 * `generateMetadata`, not a `metadata` constant: the latter is evaluated when
 * the module is first imported, which during `next build` is a worker with no
 * deployment environment. `APP_NAME` would then be missing and the build would
 * either bake in a placeholder or fail for the wrong reason. Reading it here
 * runs at request time on the server that actually serves the page.
 */
export function generateMetadata(): Metadata {
  const name = appName()
  return {
    title: name,
    description: `Discover and monitor every device on your local network with ${name}.`,
  }
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // `suppressHydrationWarning` is required, not cosmetic.
    //
    // `ThemeScript` runs before first paint and adds `class="light"` to <html>
    // when the saved theme is light. React then hydrates <html> against the
    // server HTML, which was rendered without that class, and reports a
    // mismatch — "A tree hydrated but some attributes of the server rendered
    // HTML didn't match the client properties" — with the offending attribute
    // shown as `className="light"`.
    //
    // It only ever appeared in light mode: the script toggles the class off
    // in dark mode, so the server and client attributes agreed and nothing
    // was reported. That is why it survived the move of the script out of the
    // client tree — the class on <html> is the part React compares, not the
    // script's location.
    //
    // The flag tells React to leave this one element's attributes alone. The
    // class is applied by a script that runs before React exists, so the
    // client value is the correct one and there is nothing to patch.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* F-53: applies the remembered palette before first paint. */}
        <ThemeScript />
      </head>
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}