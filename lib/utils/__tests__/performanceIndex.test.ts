import { describe, it, expect } from '@jest/globals'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * `doc/PERFORMANCE.md` is a hand-written index over three generated reports.
 * Nothing stops it drifting out of step with them, and a stale index is worse
 * than no index: it looks authoritative and is not.
 *
 * These tests read the generated files and assert the index still agrees. They
 * only run meaningfully once a perf run has produced the reports; on a fresh
 * clone `doc/` is gitignored and absent, so the suite skips rather than failing
 * for a reason that has nothing to do with the code.
 */

const DOC = path.resolve(process.cwd(), 'doc')

const REPORTS = {
  sqlite: 'PERFORMANCE.sqlite.md',
  mysql: 'PERFORMANCE.mysql.md',
  mariadb: 'PERFORMANCE.mariadb.md',
} as const

type Engine = keyof typeof REPORTS

const INDEX = 'PERFORMANCE.md'

function reportPath(engine: Engine): string {
  return path.join(DOC, REPORTS[engine])
}

const indexExists = existsSync(path.join(DOC, INDEX))
const anyReportExists = Object.values(REPORTS).some((f) => existsSync(path.join(DOC, f)))

interface ResultRow {
  name: string
  target: string
  median: string
  p95: string
  max: string
  verdict: string
}

/** Pulls the Results table out of a generated report. */
function readResults(engine: Engine): ResultRow[] {
  const text = readFileSync(reportPath(engine), 'utf8')
  const rows: ResultRow[] = []

  for (const line of text.split('\n')) {
    if (!line.startsWith('|') || line.includes('---') || line.includes('| Target |')) continue
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean)
    if (cells.length < 7) continue
    rows.push({
      name: cells[0]!,
      target: cells[1]!,
      median: cells[2]!,
      p95: cells[3]!,
      max: cells[4]!,
      verdict: cells[6]!,
    })
  }
  return rows
}

const describeIfReports = indexExists && anyReportExists ? describe : describe.skip

if (!indexExists || !anyReportExists) {
  console.warn(
    '[performance index] doc/ reports not present, skipping. Run `npm run perf:dataset && npm run perf` to produce them.'
  )
}

describeIfReports('doc/PERFORMANCE.md agrees with the generated reports', () => {
  const index = readFileSync(path.join(DOC, INDEX), 'utf8')

  it('links every engine report that exists', () => {
    for (const [engine, file] of Object.entries(REPORTS)) {
      if (!existsSync(path.join(DOC, file))) continue
      expect(index).toContain(file)
      // A report nobody links is a report nobody reads.
      expect(index).toContain(engine === 'mariadb' ? 'MariaDB' : engine === 'sqlite' ? 'SQLite' : 'MySQL')
    }
  })

  it('quotes the p95 of every measurement, for every engine, unchanged', () => {
    // The index presents one row per measurement with three engine columns.
    // Walk its Results table and check each figure against the report it
    // claims to summarise.
    const order: Engine[] = ['sqlite', 'mysql', 'mariadb']
    const rows = index
      .split('\n')
      .filter((l) => l.startsWith('|') && !l.includes('---') && l.includes('**'))
      .map((l) =>
        l
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean)
      )
      // name | target | sqlite | mysql | mariadb
      .filter((cells) => cells.length === 5 && cells.slice(2).every((c) => c.startsWith('**')))

    expect(rows.length).toBeGreaterThan(0)

    for (const cells of rows) {
      const [name, , ...values] = cells as [string, string, ...string[]]
      // Reports suffix device counts onto the name; the index does not.
      const key = name!.replace(/\s*\(\d+ devices\)/, '')

      for (const engine of order) {
        const file = reportPath(engine)
        if (!existsSync(file)) continue
        const match = readResults(engine).find((r) => r.name.replace(/\s*\(\d+ devices\)/, '') === key)
        expect({ engine, key, found: match !== undefined }).toEqual({ engine, key, found: true })
        expect({ engine, key, quoted: values[order.indexOf(engine)]!.replace(/\*\*/g, '') }).toEqual({
          engine,
          key,
          quoted: match!.p95,
        })
      }
    }
  })

  it('does not claim an all-pass the reports do not support', () => {
    // If any report carries a FAIL, the index must not say "All N measurements
    // pass" — the whole point of the gate is that a miss is visible.
    const failures: string[] = []
    for (const [engine, file] of Object.entries(REPORTS) as Array<[Engine, string]>) {
      if (!existsSync(path.join(DOC, file))) continue
      for (const row of readResults(engine)) {
        if (row.verdict !== 'pass') failures.push(`${engine}: ${row.name} is ${row.verdict}`)
      }
    }

    if (failures.length === 0) {
      expect(index).toMatch(/All \d+ measurements pass/i)
    } else {
      expect(index).not.toMatch(/All \d+ measurements pass/i)
    }
  })

  it('records the engine version each report came from', () => {
    // The engine identity has to be in the index, because DB_CLIENT=mysql
    // covers both servers and the filename alone does not disambiguate.
    for (const [engine, file] of Object.entries(REPORTS) as Array<[Engine, string]>) {
      const p = path.join(DOC, file)
      if (!existsSync(p)) continue
      const text = readFileSync(p, 'utf8')
      const m = text.match(/^\| Engine \| (.+?) \|$/m)
      expect(m).not.toBeNull()
      if (!m) continue

      if (engine === 'sqlite') {
        expect(index).toContain('better-sqlite3')
      } else if (m[1]!.startsWith('8.4')) {
        expect(index).toContain('MySQL 8.4')
      } else if (m[1]!.toLowerCase().includes('mariadb')) {
        expect(index).toContain('MariaDB 12.3')
      }
    }
  })
})
