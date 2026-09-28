// Deletes the throwaway E2E database so each run starts from a known state.
//
// This runs in the Playwright webServer command, i.e. BEFORE `next start`
// opens the file. That ordering is the whole point:
//
//   - Previously the seed ran from an e2e/global-setup.ts that playwright.config.ts
//     never referenced, so it never executed at all. The database was created
//     empty by the server's boot migrations, every login returned
//     "Invalid email or password", and 16 of 16 specs failed. The suite had
//     never actually worked, locally or in CI.
//   - Resetting the file while the server holds it open is not possible on
//     Windows anyway: the file is locked and the delete throws.
//
// So the reset has to happen first, not during setup. Kept as a script rather
// than an inline shell command because `rm -f` does not exist on Windows.

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const dbFile = process.env.DB_FILE ?? './data/e2e.db'
const resolved = path.resolve(process.cwd(), dbFile)

if (process.env.DB_FILE === './data/dev.db' || process.env.DB_FILE === 'data/dev.db') {
  console.error('Refusing to reset the development database.')
  process.exit(1)
}

if (existsSync(resolved)) {
  rmSync(resolved, { force: true })
  console.log(`Reset ${dbFile}`)
} else {
  console.log(`No existing ${dbFile}; it will be created fresh`)
}

mkdirSync(path.dirname(resolved), { recursive: true })
