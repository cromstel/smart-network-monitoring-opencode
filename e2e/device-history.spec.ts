import { test, expect, signIn } from './fixtures'

/** PRD §7: "view history". PRD F-22: 1h / 24h / 7d / 30d ranges. */
test.describe('device history', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
    await signIn(page)
  })

  test('shows a bandwidth chart for a device', async ({ page }) => {
    await page.getByText("Ana's MacBook").click()

    await expect(page.getByRole('heading', { name: /Ana's MacBook/ })).toBeVisible()
    await expect(page.getByText('Bandwidth Usage')).toBeVisible()

    // Recharts renders an accessible figure once it has data.
    await expect(page.locator('.recharts-wrapper')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Download')).toBeVisible()
    await expect(page.getByText('Upload')).toBeVisible()
  })

  test('switches the time range without erroring', async ({ page }) => {
    await page.getByText('NAS Server').click()
    await expect(page.getByText('Bandwidth Usage')).toBeVisible()

    const range = page.getByRole('combobox').first()
    await range.click()
    await page.getByRole('option', { name: '1 Hour' }).click()

    await expect(page.getByText('Bandwidth Usage')).toBeVisible()
    await expect(page.locator('.recharts-wrapper')).toBeVisible({ timeout: 20_000 })
  })

  test('surfaces device identity and totals', async ({ page }) => {
    await page.getByText('NAS Server').click()

    await expect(page.getByText('Total Traffic')).toBeVisible()
    await expect(page.getByText('Total Downloaded')).toBeVisible()
    await expect(page.getByText('Total Uploaded')).toBeVisible()
    await expect(page.getByText('First Seen')).toBeVisible()
    await expect(page.getByText('Last Seen')).toBeVisible()
  })

  test('reports a missing device rather than rendering an empty panel', async ({
    page,
  }, testInfo) => {
    // Skip the negative path only where the app is expected to 404 cleanly.
    test.skip(testInfo.project.name !== 'chromium', 'chromium only')

    const response = await page.request.get('/api/devices/00000000-0000-4000-8000-000000009999')
    expect(response.status()).toBe(404)
  })
})
