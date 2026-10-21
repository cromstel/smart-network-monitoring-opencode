'use client'

import { useEffect } from 'react'

import { STORAGE_KEY } from './ThemeScript'

/**
 * F-53: applies the stored theme to the document.
 *
 * The settings page could already *store* `theme`, but nothing ever read it —
 * the root layout hardcoded a dark palette, so choosing "Light" changed a
 * database column and nothing a user could see. This component is the missing
 * consumer.
 *
 * It is deliberately client-side and post-mount rather than a server-side
 * `class` on `<html>`:
 *
 *   - The theme is a per-user setting behind authentication. Reading it during
 *     server rendering would make every page dynamic and would flash the
 *     default palette for unauthenticated routes.
 *   - The root layout is shared with `/auth/login`, where there is no user and
 *     therefore no theme to read.
 *
 * To avoid a flash the initial value is read from `localStorage` synchronously
 * in an inline script (`ThemeScript` in the root layout), and this component
 * only *reconciles* the authoritative server value on mount. `localStorage` is
 * a cache, never the source of truth: the server's stored setting wins.
 */

export type Theme = 'dark' | 'light'

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('light', theme === 'light')
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Private mode or a storage quota: the class is already applied, which is
    // what the user sees. Only the next reload loses the head start.
  }
}

/**
 * Reconciles the rendered theme with the value the server reports.
 *
 * `theme` is `undefined` while `/api/auth/me` or `/api/settings` is still
 * loading, and `null` when the user is not signed in. Neither should change
 * what is on screen — the head script already chose the best available value.
 */
export function ThemeSync({ theme }: { theme: Theme | null | undefined }) {
  useEffect(() => {
    if (theme !== 'dark' && theme !== 'light') return
    applyTheme(theme)
  }, [theme])

  return null
}
