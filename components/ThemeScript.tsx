import { headers } from 'next/headers'

/**
 * F-53: applies the remembered palette before first paint.
 *
 * Rendered inline into <head> by the root layout, where it executes before the
 * browser paints anything. Without it a light-theme user always saw one frame
 * of the dark palette, because the class that carries the light overrides
 * (`app/globals.css`) could only be added by client JS after hydration.
 *
 * ## Why the class and not a media query
 *
 * `prefers-color-scheme` is not the stored preference: the product lets the
 * user pick a theme explicitly, and that setting lives on the server (the
 * settings table) and in `localStorage` under `hnm-theme`. This script reads
 * the local copy because it is the only thing available before the server
 * round-trip. `ThemeSync` later reconciles it with the authoritative setting.
 *
 * ## Why inline, and why a plain <script>
 *
 * Any external or bundled script would arrive after first paint — the very
 * race this closes. `next/script` does not run before paint either:
 * `beforeInteractive` still waits for the bundle to be fetched. The payload is
 * ~15 lines, so the duplication cost is nil.
 *
 * The browser only runs it because the proxy's CSP carries a per-request
 * nonce and this script is rendered with it — see the note on the component
 * below. An inline script without that nonce is simply not executed: the
 * console reports a CSP violation and the theme silently stays dark, which is
 * the failure this whole file exists to prevent, reappearing one layer down.
 *
 * ## Why <html> carries the mismatch
 *
 * The server renders <html> without the class and this script adds it, so the
 * client DOM differs from the server HTML in exactly one attribute. The root
 * layout sets `suppressHydrationWarning` on <html> to tell React not to patch
 * that one element: the script's value is the correct one, because it ran
 * before React existed. That flag is documented in `app/layout.tsx`.
 */

// Written as a string, not evaluated in this module: this is a *server*
// component, and the script must run in the browser. `dangerouslySetInnerHTML`
// is the only way to get raw, unescaped text into a <script> tag — the JSX
// text alternative would have React HTML-escape the operators.
const BOOTSTRAP = `(function(){try{var t=localStorage.getItem('hnm-theme');if(t==='light'){document.documentElement.classList.add('light')}else{document.documentElement.classList.remove('light')}}catch(e){}})();`

/**
 * The response CSP (see `proxy.ts`) is `script-src 'self' 'nonce-…'
 * 'strict-dynamic'`, so an inline script needs the request's nonce or the
 * browser silently refuses to run it. The proxy publishes the value as the
 * `x-nonce` **request** header precisely so this component can read it; Next
 * attaches the same nonce to its own bootstrap scripts automatically.
 *
 * Reading it through `headers()` is why this component is async. The header is
 * set on the request the proxy forwards, so it is present on every HTML
 * document and absent on the static assets the matcher excludes — where no
 * inline script is rendered anyway.
 */
export async function ThemeScript() {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: BOOTSTRAP }} />
}
