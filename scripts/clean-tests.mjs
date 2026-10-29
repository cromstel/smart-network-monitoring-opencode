/**
 * The cleanup rule for testing.
 *
 * Two jobs, one script:
 *
 *   node scripts/clean-tests.mjs            (default) — remove test ARTEFACTS
 *   node scripts/clean-tests.mjs --sources  — additionally remove the test
 *                                               SOURCES from the working tree
 *
 * Artefacts are the residue a test run leaves behind: coverage output and
 * Playwright reports. They are regenerated on demand, so removing them is free.
 * There is no database file to sweep any more — the test data lives in a
 * MySQL/MariaDB schema, and that is recreated by `scripts/reset-e2e-db.mjs`
 * rather than deleted from here.
 *
 * Sources are the test files themselves. They are untracked (see .gitignore),
 * which means the working tree no longer has them - but they are still in the
 * git history, so an earlier version can be restored with
 * `git show <commit>:<path> > <path>`. That is why sources are a separate,
 * explicit flag and not part of the default run: `npm run test:clean` is safe
 * to call after every run, `npm run test:purge` is a deliberate act.
 *
 * Nothing outside the project directory is touched.
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

// The soak harness's renamed node copy lives in `data/`, and that directory is
// the only part of the tree this still touches. It is not a database: the
// databases are server-side schemas, and the ones worth recreating are reset
// by dropping and rebuilding them rather than by deleting a file here.
const dataDir = join(ROOT, 'data')
if (existsSync(dataDir)) {
  for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (!DISPOSABLE_DATA_FILES.includes(entry.name)) continue
    const target = join(dataDir, entry.name)
    freed += statSync(target).size
    if (rm(target)) removed.push(`data/${entry.name}`)
  }
}

if (purgeSources) {
  const sources = findTestSources()
  for (const source of sources) {
    freed += sizeOf(source)
    rm(source)
  }
  removed.push(`${sources.length} test source file(s)`)
}

const mb = (freed / 1024 / 1024).toFixed(1)
console.log(
  removed.length === 0
    ? 'Nothing to clean — no test artefacts present.'
    : `Removed ${removed.length} item(s), ~${mb} MB freed: ${removed.join(', ')}`
)
if (purgeSources) {
  console.log(
    'Test sources deleted from the working tree. They are not in the working\n' +
      'tree any more, but they are still in the git history, so an earlier\n' +
      'version can be restored with:\n' +
      '  git show <commit>:<path> > <path>'
  )
}
