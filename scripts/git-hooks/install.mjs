#!/usr/bin/env node
// Installs the pre-commit guard into .git/hooks.
//
// The guard rejects any commit that stages a real environment file. It exists
// because an ignore rule is only as reliable as the file containing it: this
// repository's .gitignore working copy was twice silently reverted from the
// .env* glob to a literal .env / .env.* pair, after which a file holding a
// live MySQL password was both untracked and unignored. A plain `git add .` at
// that moment would have committed it. The hook makes the check independent of
// .gitignore being correct.
//
// Run manually:   npm run hooks:install
// Hooks are NOT installed by `npm install`, because postinstall hooks are
// skipped with --ignore-scripts and running repo code on install is its own
// supply-chain problem. Wire it into your own onboarding if you want it
// enforced for everyone.

import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, 'pre-commit')
const gitDir = join(here, '..', '..', '.git')
const target = join(gitDir, 'hooks', 'pre-commit')

if (!existsSync(gitDir)) {
  console.error('No .git directory here — run this from inside the repository.')
  process.exit(1)
}

if (!existsSync(source)) {
  console.error(`Hook source missing: ${source}`)
  process.exit(1)
}

mkdirSync(join(gitDir, 'hooks'), { recursive: true })
copyFileSync(source, target)

// Required on POSIX; harmless on Windows, where git uses its bundled sh.
try {
  chmodSync(target, 0o755)
} catch {
  // Nothing to do — Windows does not model the execute bit.
}

console.log('Installed pre-commit guard -> .git/hooks/pre-commit')
console.log('It blocks commits that stage .env, .env.local, .env.production, etc.')
console.log('.env.example is still allowed.')
