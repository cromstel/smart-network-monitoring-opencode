import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'

import { test as setup, expect } from '@playwright/test'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures'

/**
 * Prepares the database exactly once per run: delete the throwaway file, run
 * migrations, then seed. Individual specs assume a signed-in admin and a
 * seeded device list.
 */

const DB_FILE = path.resolve(process.cwd(), 'data/e2e.db')
const SEED_SCRIPT = path.resolve(process.cwd(), 'scripts/e2e-seed.ts')

let prepared = false

export function ensureSeeded(): void {
  if (prepared) return

  if (existsSync(DB_FILE)) {
    rmSync(DB_FILE, { force: true })
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DB_CLIENT: 'sqlite',
    DB_FILE: './data/e2e.db',
    NODE_ENV: 'test',
  }

  execFileSync('npx', ['ts-node', '--project', 'tsconfig.node.json', SEED_SCRIPT], {
    env,
    stdio: 'pipe',
  })

  prepared = true
}

setup('prepare database', async ({ page }) => {
  ensureSeeded()

  // Seeded admin credentials must be usable; fail loudly if setup drifts.
  await page.goto('/login')
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Devices' })).toBeVisible({ timeout: 20_000 })
})
