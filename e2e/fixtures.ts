import { test as base, expect, type Page } from '@playwright/test'

/**
 * Shared E2E fixtures.
 *
 * The suite runs against a throwaway SQLite file and the simulated scanner,
 * so it never touches a real network or a developer's data directory. State is
 * reset between specs by recreating the database, which keeps each spec
 * independent rather than order-dependent.
 */

export const ADMIN_EMAIL = 'e2e-admin@example.com'
export const ADMIN_PASSWORD = 'E2e-Admin-Pass-2026'
export const MEMBER_EMAIL = 'e2e-member@example.com'
export const MEMBER_PASSWORD = 'E2e-Member-Pass-2026'
export const VIEWER_EMAIL = 'e2e-viewer@example.com'
export const VIEWER_PASSWORD = 'E2e-Viewer-Pass-2026'

/** Credentials, not a session: `signInAs` drives the real form with these. */
export interface Credentials {
  email: string
  password: string
}

export const ADMIN: Credentials = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
export const MEMBER: Credentials = { email: MEMBER_EMAIL, password: MEMBER_PASSWORD }
export const VIEWER: Credentials = { email: VIEWER_EMAIL, password: VIEWER_PASSWORD }

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    // Uncaught exceptions in the page are the loudest signal available when a
    // screen renders "Application error: a client-side exception has occurred"
    // and nothing else in the trace says why. Playwright reports those as
    // test failures but not as console messages, so without this hook a real
    // runtime error is invisible in the output.
    page.on('pageerror', (err) => {
      console.error(`[pageerror] ${err.message}\n${err.stack ?? ''}`)
    })
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // Surface browser errors in the trace; do not fail the run on them,
        // because a 401 on first paint is expected before sign-in.
        if (!msg.text().includes('Failed to load resource')) {
          console.warn(`[browser] ${msg.text()}`)
        }
      }
    })
    await use(page)
  },
})

export { expect }

/**
 * Signs in through the real form so the session cookie is set the honest way.
 *
 * `destination` defaults to the overview, which is where the app sends you.
 * Pass '/devices' for the specs that then work with the device list, so the
 * landing page and the list are never conflated.
 */
export async function signIn(page: Page, destination = '/'): Promise<void> {
  await signInAs(page, ADMIN, destination)
}

/**
 * Same flow for a specific account. The seed creates one per role; the
 * role-gating spec needs to be able to arrive as somebody other than the admin
 * without duplicating this four-line dance.
 */
export async function signInAs(
  page: Page,
  credentials: Credentials,
  destination = '/'
): Promise<void> {
  await page.goto('/auth/login')
  await page.getByLabel('Email').fill(credentials.email)
  await page.getByLabel('Password').fill(credentials.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/login'), {
    timeout: 20_000,
  })
  if (destination !== '/') {
    await page.goto(destination)
    await page.waitForLoadState('domcontentloaded')
  }
}

export async function signOut(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Sign out' })
  if (await button.isVisible().catch(() => false)) {
    await button.click()
  }
}
