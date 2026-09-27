import { test, expect } from './fixtures'

/**
 * PRD §7 release criteria: "Playwright covers: login, device list, rename
 * device, view history, configure alert". This file covers the first two.
 */

test.describe('authentication and device list', () => {
  test('rejects a wrong password', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('e2e-admin@example.com')
    await page.getByLabel('Password').fill('definitely-not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('sends an unauthenticated visitor to the login page', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/alerts', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/login/)
  })

  test('signs in and lands on the device list', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/login')
    await page.getByLabel('Email').fill('e2e-admin@example.com')
    await page.getByLabel('Password').fill('E2e-Admin-Pass-2026')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Devices' })).toBeVisible()
  })

  test('lists the seeded devices with their addresses', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('e2e-admin@example.com')
    await page.getByLabel('Password').fill('E2e-Admin-Pass-2026')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Devices' })).toBeVisible()

    await expect(page.getByText("Ana's iPhone")).toBeVisible()
    await expect(page.getByText('NAS Server')).toBeVisible()
    await expect(page.getByText('A4:83:E7:2C:11:09')).toBeVisible()
  })

  test('filters the list as the user types', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('e2e-admin@example.com')
    await page.getByLabel('Password').fill('E2e-Admin-Pass-2026')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Devices' })).toBeVisible()

    await page.getByPlaceholder('Search devices...').fill('NAS')

    await expect(page.getByText('NAS Server')).toBeVisible()
    await expect(page.getByText("Ana's iPhone")).toBeHidden()
  })

  test('signs out and revokes access', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('e2e-admin@example.com')
    await page.getByLabel('Password').fill('E2e-Admin-Pass-2026')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Devices' })).toBeVisible()

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)

    await page.goto('/alerts')
    await expect(page).toHaveURL(/\/login/)
  })
})
