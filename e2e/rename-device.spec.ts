import { test, expect, signIn } from './fixtures'

/** PRD §7: "rename device". */
test.describe('rename a device', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
    await signIn(page)
  })

  test('renames a device and the change survives a reload', async ({ page }) => {
    const newName = `Kitchen Printer ${Date.now() % 10000}`

    await page.getByText('Office Printer').click()

    await expect(page.getByRole('dialog')).toBeVisible()
    const nameField = page.getByLabel('Device Name')
    await nameField.fill(newName)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15_000 })

    await expect(page.getByRole('heading', { name: newName })).toBeVisible()

    // The rename must be persisted, not just optimistic UI state.
    await page.reload()
    await expect(page.getByRole('heading', { name: newName })).toBeVisible({ timeout: 15_000 })
  })

  test('cancelling a rename leaves the original name intact', async ({ page }) => {
    await page.getByText('Living Room TV').click()

    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Device Name').fill('Should Not Persist')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Living Room TV' })).toBeVisible({
      timeout: 15_000,
    })
  })
})
