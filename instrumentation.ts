/**
 * Instrumentation hook.
 *
 * Next.js calls `register()` once per server process, before the server accepts
 * requests, and on *every* runtime it builds for -- including Edge, where none
 * of this application's server code can run (the database, the scanners and the
 * scheduler all need Node.js).
 *
 * Because this file is compiled for Edge as well, any static import here is
 * pulled into an Edge compilation too. That is why the actual boot work lives in
 * `./instrumentation.node` and is imported only when the runtime really is
 * Node.js: importing it statically dragged better-sqlite3, `node:child_process`,
 * `node:fs` and the scanner stack into the Edge bundle and produced eleven
 * "A Node.js module is loaded ... not supported in the Edge Runtime" warnings on
 * every build. The conditional `import()` is the pattern Next.js documents for
 * exactly this, and it keeps the Edge bundle limited to this file.
 *
 * `process.env.NEXT_RUNTIME` is replaced with a literal per compilation, so the
 * guard is statically false for Edge and the import is never reached there.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NODE_ENV === 'test') return

  const { registerNode } = await import('./instrumentation.node')
  registerNode()
}
