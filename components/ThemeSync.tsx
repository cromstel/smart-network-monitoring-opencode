'use client'

import { useEffect } from 'react'

/**
 * F-53: reconciles the palette applied by `ThemeScript` with the stored
 * setting.
 *
 * The pre-paint script guesses from `localStorage`; this component replaces
 * that guess with the **server** setting as soon as `/api/settings` answers.
 * The server value wins, which is the only way one account can keep its theme
 * across devices and a new browser tab cannot start out of sync with the
 * profile that owns it.
 *
 * It also writes the value back to `localStorage`, so the next page load's
 * pre-paint guess is already correct and there is no second flash. Without the
 * write-back, a user who saved "light" on this device would still get a frame
 * of dark on every reload — the exact symptom `ThemeScript` exists to fix.
 *
 * Renders nothing: the theme is expressed as a class on <html>, not as markup.
 */

export type Theme = 'dark' | 'light'

/**
 * Same key and same class name the pre-paint script uses. They are duplicated
 * rather than imported because `ThemeScript` is a server component whose
 * payload is a literal string — the two files must stay in sync when this is
 * changed, and `scripts/audit-theme.mjs` asserts the end result
 * (`document.documentElement.className === 'light'`) in CI.
 */
const STORAGE_KEY = 'hnm-theme'
const LIGHT_CLASS = 'light'

export function ThemeSync({ theme }: Readonly<{ theme?: Theme }>) {
  useEffect(() => {
    // `undefined` means the settings request has not answered yet. Doing
    // nothing leaves ThemeScript's remembered value in place, which is the
    // best available answer — clearing it here would drop a signed-in user
    // into dark mode for no reason on every cold load.
    if (!theme) return

    // `toggle(class, force)` rather than add/remove: the dark branch has to
    // actively *remove* the class, because the pre-paint script may have put
    // it there from a stale value.
    document.documentElement.classList.toggle(LIGHT_CLASS, theme === 'light')

    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Private-browsing modes throw on write. The theme still applies for
      // this session; only the next-reload flash remains, and losing the
      // whole render to an unhandled rejection would be a worse trade.
    }
  }, [theme])

  return null
}
