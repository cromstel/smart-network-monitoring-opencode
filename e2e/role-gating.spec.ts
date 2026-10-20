import { test, expect, signInAs, ADMIN, MEMBER, VIEWER, type Credentials } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * PRD F-62 / Phase C1: the role determines which write controls are *shown*.
 *
 * Authorisation itself is enforced in every handler (`lib/api/auth.ts`) and is
 * covered by the integration tests; this file is about the affordances, which
 * had no end-to-end coverage at all before the seed gained a second and third
 * account. That gap is exactly how the C1 defect survived: the alerts surface
 * was gated, the device-rename trigger and all three settings submit buttons
 * were not, and every spec signed in as the admin, so no run ever saw the
 * difference.
 *
 * The matrix being pinned:
 *
 *   ADMIN   canManage ✓  isAdmin ✓
 *   MEMBER  canManage ✓  isAdmin ✗
 *   VIEWER  canManage ✗  isAdmin ✗
 *
 * Two mechanics matter for these assertions to mean anything:
 *
 *  - `permissionsFor` fails *open* for `canManage` while the role is still
 *    unknown, so for a VIEWER the controls are briefly present and then
 *    disappear. Asserting only "hidden" would pass against a page that never
 *    rendered them for an unrelated reason. Every check therefore first waits
 *    for the sidebar to echo the role — the layout and the page share one
 *    react-query cache entry (`['auth', 'me']`), so once the sidebar has the
 *    role the page's `permissions` are derived from it too.
 *  - `isAdmin` fails closed, so the settings buttons are absent from the first
 *    paint for everyone, and only appear after the role resolves. Same anchor,
 *    opposite direction: without it "Save changes is visible" as ADMIN would
 *    be a race the spec would sometimes lose.
 */

const deleteButtons = (page: Page) => page.getByRole('button', { name: 'Delete rule' })
const saveChanges = (page: Page) => page.getByRole('button', { name: 'Save changes', exact: true })
const saveRouter = (page: Page) => page.getByRole('button', { name: 'Save router', exact: true })
const savePaystack = (page: Page) => page.getByRole('button', { name: 'Save PayStack', exact: true })

/**
 * Navigates and waits until the layout has resolved the signed-in role.
 * `role` is the raw enum value the sidebar renders; `text-transform` is CSS
 * only, so the DOM text is already uppercase.
 */
async function gotoAs(page: Page, path: string, role: string): Promise<void> {
  await page.goto(path)
  await expect(page.locator('aside').getByText(role, { exact: true })).toBeVisible()
}

/** The device the detail-page checks run against: any seeded one will do. */
async function firstDevicePath(page: Page): Promise<string> {
  const id = await page.evaluate(async () => {
    const res = await fetch('/api/devices?pageSize=1')
    const body = (await res.json()) as { data?: Array<{ id?: string }> }
    return body.data?.[0]?.id
  })
  expect(id, 'the seed should provide at least one device').toBeTruthy()
  return `/devices/${id}`
}

async function signInAndAwaitRole(page: Page, who: Credentials, role: string): Promise<void> {
  await page.context().clearCookies()
  await signInAs(page, who)
  await expect(page.locator('aside').getByText(role, { exact: true })).toBeVisible()
}

test.describe('role-aware UI', () => {
  test('VIEWER is shown no write controls on any surface', async ({ page }) => {
    await signInAndAwaitRole(page, VIEWER, 'VIEWER')

    // Alert rules: the whole "New rule" panel is gone, not just its button.
    await gotoAs(page, '/alerts', 'VIEWER')
    await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'New rule' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add rule' })).toHaveCount(0)
    await expect(deleteButtons(page)).toHaveCount(0)

    // Device rename. This control was visible to a VIEWER before C1 was closed.
    const devicePath = await firstDevicePath(page)
    await gotoAs(page, devicePath, 'VIEWER')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)

    // Global settings: the three submit buttons are all absent, while the page
    // itself still loads, because GET /api/settings allows every role.
    await gotoAs(page, '/settings', 'VIEWER')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(saveChanges(page)).toHaveCount(0)
    await expect(saveRouter(page)).toHaveCount(0)
    await expect(savePaystack(page)).toHaveCount(0)
  })

  test('MEMBER manages its own resources but not global settings', async ({ page }) => {
    await signInAndAwaitRole(page, MEMBER, 'MEMBER')

    // The member boundary: same manage rights as an admin...
    await gotoAs(page, '/alerts', 'MEMBER')
    await expect(page.getByRole('heading', { name: 'New rule' })).toBeVisible()

    const devicePath = await firstDevicePath(page)
    await gotoAs(page, devicePath, 'MEMBER')
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()

    // ...but no access to global configuration. This is the assertion that
    // separates MEMBER from ADMIN; a `canManage` mistakenly wired to the
    // settings buttons would pass the two checks above and fail here.
    await gotoAs(page, '/settings', 'MEMBER')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(saveChanges(page)).toHaveCount(0)
    await expect(saveRouter(page)).toHaveCount(0)
    await expect(savePaystack(page)).toHaveCount(0)
  })

  test('ADMIN sees every write control', async ({ page }) => {
    await signInAndAwaitRole(page, ADMIN, 'ADMIN')

    await gotoAs(page, '/alerts', 'ADMIN')
    await expect(page.getByRole('heading', { name: 'New rule' })).toBeVisible()

    const devicePath = await firstDevicePath(page)
    await gotoAs(page, devicePath, 'ADMIN')
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()

    await gotoAs(page, '/settings', 'ADMIN')
    await expect(saveChanges(page)).toBeVisible()
    await expect(saveRouter(page)).toBeVisible()
    await expect(savePaystack(page)).toBeVisible()
  })

  test('the API refuses VIEWER and admits MEMBER regardless of the UI', async ({ page }) => {
    // Hiding a control is a courtesy; the handler is the enforcement. These
    // calls prove the two layers agree, and are deliberately non-mutating:
    // an empty body is refused by validation *after* the role gate, so a 400
    // means "authorised but malformed" and a 403 means "not authorised".
    await signInAndAwaitRole(page, VIEWER, 'VIEWER')

    const asViewer = await page.evaluate(async () => {
      const json = { 'Content-Type': 'application/json' }
      const post = (path: string) =>
        fetch(path, { method: 'POST', headers: json, body: '{}' }).then((r) => r.status)
      const patch = (path: string) =>
        fetch(path, { method: 'PATCH', headers: json, body: '{}' }).then((r) => r.status)
      return {
        alerts: await post('/api/alerts'),
        settings: await patch('/api/settings'),
        device: await patch('/api/devices/00000000-0000-4000-8000-000000000000'),
      }
    })

    expect(asViewer).toEqual({ alerts: 403, settings: 403, device: 403 })

    // Same three calls as a MEMBER: the manage surfaces admit it (400/404,
    // never 403), the global one does not.
    await signInAndAwaitRole(page, MEMBER, 'MEMBER')

    const asMember = await page.evaluate(async () => {
      const json = { 'Content-Type': 'application/json' }
      const post = (path: string) =>
        fetch(path, { method: 'POST', headers: json, body: '{}' }).then((r) => r.status)
      const patch = (path: string) =>
        fetch(path, { method: 'PATCH', headers: json, body: '{}' }).then((r) => r.status)
      return {
        alerts: await post('/api/alerts'),
        settings: await patch('/api/settings'),
        device: await patch('/api/devices/00000000-0000-4000-8000-000000000000'),
      }
    })

    expect(asMember.alerts).toBe(400)
    expect(asMember.settings).toBe(403)
    // 400 "No valid fields to update": the role gate passed, then the
    // deliberately empty patch was refused before any device lookup.
    expect(asMember.device).toBe(400)
  })
})
