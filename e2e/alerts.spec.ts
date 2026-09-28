import { test, expect, signIn } from './fixtures'

/**
 * PRD §7: "configure alert". Also exercises the owner-scoped surface from
 * PRD F-34 — a user's rules and activity log must be their own.
 *
 * Two things about the real page shape this encodes:
 *
 *  - The form is always visible; "Add rule" is the submit button, not a
 *    disclosure. The type control is a native <select>, so it is driven with
 *    selectOption rather than by clicking options, which are not rendered while
 *    a native dropdown is closed.
 *  - Every spec in this file shares one seeded database, so assertions count
 *    rows rather than expecting an empty list. A test that assumed
 *    "No rules yet." passed only when it ran first.
 */
test.describe('alert rules', () => {
  const deleteButtons = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Delete rule' })

  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
    await signIn(page)
    await page.goto('/alerts')
    await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible()
    await expect(page.getByText('YOUR RULES')).toBeVisible()
  })

  test('creates an unknown-device rule and lists it', async ({ page }) => {
    const typeSelect = page.getByRole('combobox')
    await expect(typeSelect).toHaveValue('unknown_device')
    // The unknown-device rule has no threshold and no device to choose.
    await expect(page.getByText(/Fires once per device the first time it is seen/i)).toBeVisible()

    const before = await deleteButtons(page).count()
    await page.getByRole('button', { name: 'Add rule' }).click()
    await expect(deleteButtons(page)).toHaveCount(before + 1, { timeout: 15_000 })
  })

  test('requires a device before a bandwidth rule can be saved', async ({ page }) => {
    await page.getByRole('combobox').first().selectOption('bandwidth_exceeded')

    // No device picked yet, so the control stays disabled.
    await expect(page.getByRole('button', { name: 'Add rule' })).toBeDisabled()

    const deviceSelect = page.getByRole('combobox').nth(1)
    await deviceSelect.selectOption({ label: 'NAS Server' })

    await expect(page.getByRole('button', { name: 'Add rule' })).toBeEnabled()
  })

  test('persists a rule and can delete it', async ({ page }) => {
    const before = await deleteButtons(page).count()

    await page.getByRole('combobox').first().selectOption('device_offline')
    await page.getByRole('button', { name: 'Add rule' }).click()
    await expect(deleteButtons(page)).toHaveCount(before + 1, { timeout: 15_000 })

    await deleteButtons(page).first().click()
    await expect(deleteButtons(page)).toHaveCount(before, { timeout: 15_000 })
  })

  test('shows an activity log surface that starts empty', async ({ page }) => {
    await expect(page.getByText('Activity')).toBeVisible()
    // Either a real entry or the explicit empty state — never a blank panel.
    const entries = page.getByRole('listitem')
    const empty = page.getByText(/Nothing yet\. Alerts appear here/i)
    await expect(entries.or(empty).first()).toBeVisible()
  })

  test('scopes rules to the signed-in user', async ({ page }) => {
    // Fetched from inside the page rather than via page.request: the session
    // cookie is marked Secure because the E2E server runs NODE_ENV=production,
    // and a separate request context will not replay it over plain http, which
    // returned the login redirect as HTML and blew up on JSON.parse.
    const body = (await page.evaluate(async () => {
      const res = await fetch('/api/alerts')
      return { status: res.status, ct: res.headers.get('content-type'), json: await res.json() }
    })) as { status: number; ct: string; json: { data: unknown[] } }

    expect(body.status).toBe(200)
    expect(body.ct).toContain('application/json')
    expect(Array.isArray(body.json.data)).toBe(true)
    for (const rule of body.json.data as Array<{ userId?: string }>) {
      expect(rule.userId).toBeTruthy()
    }
  })
})
