import { test, expect, signIn } from './fixtures'

/**
 * The theme gap, verified through the UI.
 *
 * `theme` was stored, round-tripped through `PATCH /api/settings`, and read
 * back by the settings form — while the app rendered a hardcoded dark palette
 * that no setting could change. A passing unit test on the *stored value* would
 * have been green the whole time. The only assertion that distinguishes "the
 * setting works" from "the setting is recorded" is one made against the
 * rendered document.
 *
 * `<html>` carries the `light` class, and `app/globals.css` overrides the
 * slate utilities under it. So the observable contract is:
 *
 *   - the class is absent by default,
 *   - present after saving "Light",
 *   - still present after a reload (the setting is persisted, not just applied
 *     to the live DOM),
 *   - gone again after saving "Dark".
 */

async function setTheme(page: import('@playwright/test').Page, theme: 'Dark' | 'Light') {
  await page.goto('/settings')
  const select = page.getByLabel('Theme')
  await expect(select).toBeVisible({ timeout: 20_000 })
  await select.selectOption(theme)

  // `Save changes` submits both forms' shared mutation; scoping by the select's
  // own form is belt-and-braces against the PayStack/Router buttons, which are
  // in separate forms further down.
  await page
    .getByLabel('Theme')
    .locator('xpath=ancestor::form[1]')
    .getByRole('button', { name: /save changes/i })
    .click()

  await expect(page.getByText('Saved. The scan interval applies from the next cycle.')).toBeVisible({
    timeout: 20_000,
  })
}

test.describe('theme (F-53) — the saved setting is what renders', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('applies the light palette when the user saves Light', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByLabel('Theme')).toBeVisible({ timeout: 20_000 })

    // Default: the dark palette, i.e. no override class.
    await expect(page.locator('html')).not.toHaveClass(/light/)

    await setTheme(page, 'Light')

    await expect(page.locator('html')).toHaveClass(/light/, { timeout: 20_000 })
  })

  test('keeps the light palette across a reload', async ({ page }) => {
    await setTheme(page, 'Light')

    // A reload discards the React tree; only a *persisted* setting survives it,
    // which is the difference between storing the theme and merely toggling a
    // class for the current session.
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/light/, { timeout: 20_000 })
  })

  test('returns to dark when the user saves Dark again', async ({ page }) => {
    await setTheme(page, 'Light')
    await expect(page.locator('html')).toHaveClass(/light/, { timeout: 20_000 })

    await setTheme(page, 'Dark')
    await expect(page.locator('html')).not.toHaveClass(/light/, { timeout: 20_000 })
  })

  test('the light palette is visually distinguishable from dark', async ({ page }) => {
    // The class assertion above proves the *switch* is wired. This proves the
    // switch has a visible effect: without a palette behind it, `.light` would
    // be a no-op class and every earlier assertion would still pass.
    await page.goto('/settings')
    await expect(page.getByLabel('Theme')).toBeVisible({ timeout: 20_000 })

    const darkBackground = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    )

    await setTheme(page, 'Light')
    await expect(page.locator('html')).toHaveClass(/light/, { timeout: 20_000 })

    const lightBackground = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    )

    expect(lightBackground).not.toBe(darkBackground)

    // Sanity-check the direction: light mode must actually be lighter. Parsing
    // the channels avoids asserting an exact colour that a palette tweak would
    // break for no reason.
    const luminance = (rgb: string) => {
      const [r, g, b] = rgb.match(/\d+/g)!.map(Number)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    expect(luminance(lightBackground)).toBeGreaterThan(luminance(darkBackground) + 100)
  })
})
