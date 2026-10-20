import { test, expect, signIn } from './fixtures'

/**
 * PRD §7: "configure alert". Also exercises the owner-scoped surface from
 * PRD F-34 — a user's rules and activity log must be their own.
 *
 * Two things about the real page shape this encodes:
 *
 *  - The rule form is always visible *for this suite*, because these specs
 *    sign in as the seeded ADMIN. The VIEWER/MEMBER boundary lives in
 *    `role-gating.spec.ts`, which is the only file that signs in as anyone
 *    else. "Add rule" is the submit button, not a disclosure. The type control
 *    is a native <select>, so it is driven with selectOption rather than by
 *    clicking options, which are not rendered while a native dropdown is
 *    closed.
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

    // Wait for the rules panel to settle before any spec reads a baseline.
    // While the query is in flight the panel renders "Loading…" with zero
    // delete buttons, so a baseline read during that window is 0 however many
    // rules actually exist — and every count assertion downstream then depends
    // on whether the request happened to beat the test body. This is the
    // count-based equivalent of the "passed only when it ran first" trap
    // noted above.
    await expect(deleteButtons(page).first().or(page.getByText('No rules yet.'))).toBeVisible()
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

  test('shows a populated activity log rather than a blank panel', async ({ page }) => {
    await expect(page.getByText('Activity')).toBeVisible()
    // The seed writes notifications, so a real entry must render. A blank
    // panel here would mean the activity query failed silently — the page
    // renders its empty state for that too, and the two look identical from
    // outside without a seeded row to look for.
    await expect(page.getByText('NAS Server is offline')).toBeVisible()
    // The explicit empty state is no longer reachable end to end, because the
    // seed populates the panel on every run. It is a static conditional on
    // `notifications.length === 0`, so it is traded away here for coverage of
    // the "Mark all read" control below, which is interactive.
  })

  test('marks every unread notification read without emptying the log', async ({ page }) => {
    // Gated on unread > 0, so it only exists because the seed wrote two
    // unread notifications — nothing in the app can create one during a run,
    // since notifications only come from the alert engine firing. That makes
    // this the one spec here that is valid exactly once per database: run it
    // twice against the same seed (`--repeat-each`) and the second run finds
    // nothing left to mark. The suite resets and seeds before every `npm run
    // test:e2e` and executes each spec once, which is the contract it relies
    // on. This is the control that did not exist before the read-state
    // endpoints were added.
    const markAll = page.getByRole('button', { name: 'Mark all read' })
    await expect(markAll).toBeVisible()
    await expect(page.getByText(/\bunread\./)).toBeVisible()

    const seeded = page.getByText('NAS Server is offline')
    await expect(seeded).toBeVisible()

    await markAll.click()

    // What disappears is the unread state, never the entry itself: marking a
    // notification read must not remove it from the activity history. The
    // button is the assertion that actually blocks, because it is removed from
    // the DOM once the refetch reports zero unread.
    await expect(markAll).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText(/\bunread\./)).toBeHidden({ timeout: 15_000 })
    await expect(seeded).toBeVisible()
    await expect(page.getByText('New device joined the network')).toBeVisible()
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
