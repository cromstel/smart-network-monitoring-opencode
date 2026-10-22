/**
 * The cleanup rule for testing.
 *
 * Two jobs, one script:
 *
 *   node scripts/clean-tests.mjs            (default) — remove test ARTEFACTS
 *   node scripts/clean-tests.mjs --sources  — additionally remove the test
 *                                               SOURCES from the working tree
 *
 * Artefacts are the residue a test run leaves behind: coverage output,
 * Playwright reports, the throwaway SQLite databases the suites and the
 * perf/soak harnesses create, and the Jest cache. They are regenerated on
 * demand, so removing them is free.
 *
 * Sources are the test files themselves. They are untracked (see .gitignore),
 * which means git cannot restore them — deleting them is irreversible except
 * through a backup. That is why sources are a separate, explicit flag and
 * not part of the default run: `npm run test:clean` is safe to call after
 * every run, `npm run test:purge` is a deliberate act.
 *
 * Nothing outside the project directory is touched, and `data/dev.db` — the
 * live development database with the user's accounts and scan history — is
 * explicitly preserved.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const purgeSources = process.argv.includes('--sources')

/** Artefacts a test run leaves behind. All regenerable. */
const ARTEFACTS = [
  'coverage',
  'playwright-report',
  'test-results',
  '.jest-cache',
]

/**
 * Throwaway databases created by the test, perf and soak harnesses.
 *
 * `data/dev.db` is deliberately absent: it is the live development database
 * with the user's accounts, settings and scan history. Only databases whose
 * name identifies them as disposable are removed.
 */
const DISPOSABLE_DB_NAMES = [
  'e2e.db',
  'perf.db',
  'fcp.db',
  'soak.db',
  'test.db',
]

/**
 * Compiled test binaries the soak harness leaves behind.
 *
 * `node-soak.exe` is a copy of the node binary used to hold a soak run alive;
 * it is a build artefact of the harness, not data.
 */
const DISPOSABLE_DATA_FILES = ['node-soak.exe']

function rm(target) {
  if (!existsSync(target)) return false
  rmSync(target, { recursive: true, force: true })
  return true
}

/**
 * Total size of a file or directory tree, in bytes.
 *
 * `Dirent` has no `size` property — that is `Stats` — so a recursive
 * `readdir` with `withFileTypes` cannot be summed directly. It reported NaN
 * for every directory it removed.
 */
function sizeOf(target) {
  if (!existsSync(target)) return 0
  const st = statSync(target)
  if (!st.isDirectory()) return st.size
  let total = 0
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    total += sizeOf(join(target, entry.name))
  }
  return total
}

/** Every file in the tree that matches a test-source pattern. */
function findTestSources(dir = ROOT, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') {
        acc.push(full)
        continue
      }
      findTestSources(full, acc)
    } else if (
      /\.test\.tsx?$/.test(entry.name) ||
      /\.spec\.tsx?$/.test(entry.name)
    ) {
      acc.push(full)
    }
  }
  return acc
}

let freed = 0
const removed = []

for (const artefact of ARTEFACTS) {
  const target = join(ROOT, artefact)
  if (existsSync(target)) {
    freed += sizeOf(target)
    if (rm(target)) removed.push(artefact)
  }
}

const dataDir = join(ROOT, 'data')
if (existsSync(dataDir)) {
  for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const isDisposable =
      DISPOSABLE_DB_NAMES.some(
        (name) => entry.name === name || entry.name.startsWith(`${name}-`)
      ) ||
      DISPOSABLE_DATA_FILES.includes(entry.name) ||
      // The soak harness writes timestamped databases (soak-partial-*.db,
      // soak-smoke.db) as well as the fixed one.
      (/^soak.*\.db$/.test(entry.name) && entry.name !== 'soak.db')
    if (!isDisposable) continue
    const target = join(dataDir, entry.name)
    freed += statSync(target).size
    if (rm(target)) removed.push(`data/${entry.name}`)
  }
}

if (purgeSources) {
  for (const source of findTestSources()) {
    freed += sizeOf(source)
    rm(source)
  }
  removed.push('test sources')
}

const mb = (freed / 1024 / 1024).toFixed(1)
console.log(
  removed.length === 0
    ? 'Nothing to clean — no test artefacts present.'
    : `Removed ${removed.length} item(s), ~${mb} MB freed: ${removed.join(', ')}`
)
if (purgeSources) {
  console.log(
    'Test sources deleted from the working tree. They were untracked, so git cannot restore them.'
  )
}
