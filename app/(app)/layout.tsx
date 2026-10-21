import { appName } from '@/lib/config/app'
import { DashboardShell } from './DashboardShell'

/**
 * A server component, so `appName()` resolves `APP_NAME` on the server.
 *
 * The shell it renders is a client component because the sidebar is
 * interactive. `process.env.APP_NAME` is not present in the browser bundle, so
 * the name has to cross the boundary as a **prop** — reading it on the client
 * side renders an empty heading, and in the earlier version threw
 * `MissingAppIdentityError` from a client chunk during the E2E run.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <DashboardShell appName={appName()}>{children}</DashboardShell>
}
