import Script from 'next/script'

/**
 * localStorage key for the remembered palette.
 *
 * Lives here, in a directive-free module shared by both graphs, so the head
 * script and the post-mount reconciler (`ThemeSync`) cannot drift apart.
 */
export const STORAGE_KEY = 'hnm-theme'

/**
 * F-53: applies the remembered palette before first paint.
 *
 * ## Why this is its own file, with no `'use client'`
 *
 * It used to live in `components/ThemeSync.tsx`, which is a client component —
 * and React 19 / Next 16 reject `next/script` rendered from the client tree:
 *
 *     Encountered a script tag while rendering React component. Scripts inside
 *     React components are never executed when rendering on the client.
 *
 * `strategy="beforeInteractive"` hoists the script into the document head and
 * runs it ahead of hydration, *outside* React's reconciliation. That only
 * happens when the component is rendered on the server. Reached through a
 * client component the script becomes an element React tries to hydrate — the
 * error above — so the hoisting never happens and the flash guard is gone.
 *
 * The root layout is a server component and renders this from `<head>`, which
 * is the documented location for `beforeInteractive`. Keep this file free of
 * directives and of client-only imports so it stays in the server graph.
 *
 * The reconciliation half (`applyTheme`, `ThemeSync`) lives in
 * `components/ThemeSync.tsx`, which remains `'use client'` — those run after
 * mount and never render a script.
 */
export function ThemeScript() {
  const script = `
(function() {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var theme = stored === 'light' ? 'light' : 'dark';
    document.documentElement.classList.toggle('light', theme === 'light');
  } catch (e) {}
})();
`
  return (
    <Script id="hnm-theme-init" strategy="beforeInteractive">
      {script}
    </Script>
  )
}
