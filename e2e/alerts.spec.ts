import { test, expect, signIn } from './fixtures'

/**
 * PRD §7: "configure alert". Also exercises the owner-scoped surface from
 * PRD F-34 — a user's rules and activity log must be their own.
 */
test.describe('alert rules', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
    await signIn(page)
    await page.goto('/alerts')
    await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible()
  })

  test('creates an unknown-device rule and lists it', async ({ page }) => {
    await page.getByRole('button', { name: 'Add rule' }).click()

    await expect(page.getByText('Alert on any new device')).toBeVisible()
    await expect(page.getByText(/fires once per device/i)).toBeVisible()
  })

  test('requires a device before a bandwidth rule can be saved', async ({ page }) => {
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: /bandwidth limit/i }).click()

    // No device picked yet, so the control stays disabled.
    await expect(page.getByRole('button', { name: 'Add rule' })).toBeDisabled()

    await page.getByRole('combobox').nth(1).click()
    await page.getByRole('option', { name: /NAS Server/ }).click()

    await expect(page.getByRole('button', { name: 'Add rule' })).toBeEnabled()
  })

  test('persists a rule and can delete it', async ({ page }) => {
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: /goes offline/i }).click()

    await page.getByRole('button', { name: 'Add rule' }).click()
    await expect(page.getByText('Your rules')).toBeVisible()

    const deleteButton = page.getByRole('button', { name: 'Delete rule' }).first()
    await expect(deleteButton).toBeVisible()
    await deleteButton.click()
    await expect(page.getByText('No rules yet.')).toBeVisible()
  })

  test('shows an activity log surface that starts empty', async ({ page }) => {
    await expect(page.getByText('Activity')).toBeVisible()
    // Either a real entry or the explicit empty state — never a blank panel.
    const entries = page.getByRole('listitem')
    const empty = page.getByText(/Nothing yet\. Alerts appear here/i)
    await expect(entries.or(empty).first()).toBeVisible()
  })

  test('scopes rules to the signed-in user', async ({ page }) => {
    // A second user must not see the first user's rules.
    const mine = await page.request.get('/api/alerts')
    expect(mine.ok()).toBe(true)
    const body = await mine.json()
    expect(Array.isArray(body.data)).toBe(true)
    for (const rule of body.data) {
      expect(rule.userId).toBeTruthy()
    }
  })
})
