import { test, expect, signIn } from './fixtures'

/**
 * PRD §7 release criteria: "Playwright covers: login, device list, rename
 * device, view history, configure alert". This file covers the first two.
 */

test.describe('authentication and device list', () => {
  test('rejects a wrong password', async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByLabel('Email').fill('e2e-admin@example.com')
    await page.getByLabel('Password').fill('definitely-not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page).toHaveURL((url) => url.pathname === '/auth/login')
  })

  test('sends an unauthenticated visitor to the login page', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/alerts', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL((url) => url.pathname === '/auth/login')
  })

  test('returns the visitor to the page they asked for after signing in', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/alerts', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL((url) => url.pathname === '/auth/login')

    // The middleware records the denied path in ?redirect=, so a deep link
    // survives the login detour instead of dumping everyone on the overview.
    await expect(page).toHaveURL((url) => url.searchParams.get('redirect') === '/alerts')

    await page.getByLabel('Email').fill('e2e-admin@example.com')
    await page.getByLabel('Password').fill('E2e-Admin-Pass-2026')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).toHaveURL((url) => url.pathname === '/alerts')
  })

  test('ignores a crafted redirect instead of navigating off-origin', async ({
    page,
  }, testInfo) => {
    // The redirect param is attacker-controllable: a link to
    // /auth/login?redirect=https://elsewhere made the client navigate to that
    // origin after sign-in. Values that are not same-origin paths are dropped.
    const base = testInfo.project.use.baseURL as string

    for (const hostile of [
      'https://evil.example.com/pwn',
      '//evil.example.com/pwn',
      '/\\evil.example.com/pwn',
    ]) {
      await page.context().clearCookies()
      await page.goto(`/auth/login?redirect=${encodeURIComponent(hostile)}`)
      await page.getByLabel('Email').fill('e2e-admin@example.com')
      await page.getByLabel('Password').fill('E2e-Admin-Pass-2026')
      await page.getByRole('button', { name: 'Sign in' }).click()

      // Landed on the overview rather than the injected destination...
      await expect(page).toHaveURL((url) => url.pathname === '/')
      // ...and is still on this origin. Compared against the configured
      // baseURL, not against itself, which would assert nothing.
      expect(new URL(page.url()).origin).toBe(new URL(base).origin)
    }
  })

  test('signs in and lands on the overview', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/auth/login')
    await page.getByLabel('Email').fill('e2e-admin@example.com')
    await page.getByLabel('Password').fill('E2e-Admin-Pass-2026')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).not.toHaveURL((url) => url.pathname === '/auth/login')
    // '/' is the overview now; the device list moved to /devices.
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
  })

  test('lists the seeded devices with their addresses', async ({ page }) => {
    await signIn(page, '/devices')
    await expect(page.getByRole('heading', { level: 1, name: 'Devices' })).toBeVisible()

    await expect(page.getByText("Ana's iPhone")).toBeVisible()
    await expect(page.getByText('NAS Server')).toBeVisible()
    await expect(page.getByText('A4:83:E7:2C:11:09')).toBeVisible()
  })

  test('filters the list as the user types', async ({ page }) => {
    await signIn(page, '/devices')
    await expect(page.getByRole('heading', { level: 1, name: 'Devices' })).toBeVisible()

    await page.getByPlaceholder('Search devices...').fill('NAS')

    // Order the waits so the one that can actually block comes first.
    // "NAS Server" is already in the unfiltered list, so asserting it is
    // visible returns immediately and proves nothing about whether the filter
    // has been applied; the second assertion then raced the response and
    // failed roughly one full run in four. "Anas iPhone" is present before
    // the search and absent after it, so waiting for it to disappear is the
    // assertion that genuinely blocks until the filtered results have rendered.
    await expect(page.getByText("Ana's iPhone")).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText("NAS Server")).toBeVisible()
    await expect(page.getByText("Living Room TV")).toBeHidden({ timeout: 15_000 })
  })

  test('signs out and revokes access', async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByLabel('Email').fill('e2e-admin@example.com')
    await page.getByLabel('Password').fill('E2e-Admin-Pass-2026')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL((url) => url.pathname === '/auth/login')

    await page.goto('/alerts')
    await expect(page).toHaveURL((url) => url.pathname === '/auth/login')
  })
})
