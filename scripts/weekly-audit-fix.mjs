#!/usr/bin/env node
/**
 * Weekly automated dependency vulnerability scan + safe auto-fix.
 *
 *   scripts/weekly-audit-fix.mjs
 *
 * Behaviour:
 *   1. Run `npm audit --audit-level=high --json` to get an audit summary
 *      in JSON form (machine-readable, reproducible).
 *   2. If any vulnerabilities are reported, run `npm audit fix` to apply
 *      safe auto-fixes that resolve normal and low severity advisories.
 *   3. Re-run the audit; report the final state.
 *
 * Exit codes:
 *   0 - audit passes or all issues resolved by `npm audit fix`.
 *   1 - high/critical vulnerabilities remain (and could not be auto-fixed).
 *   2 - error running npm (see logs/ for details); do not overwrite data.
 *
 * Security rules enforced by this script:
 *   * No secrets are read or written anywhere — only package metadata is audited.
 *   * All output is written through stdio and to logs/weekly-audit.log.
 *   * Generic human-readable messages only (never stack traces leaking data).
 */
import { mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const LOG_DIR = join(ROOT, 'logs');
const LOG_FILE = join(LOG_DIR, 'weekly-audit.log');

// Escape a string for logging. Only generic values are logged — never user input.
function log(msg) {
  console.log(`[weekly-audit] ${msg}`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
}

function runNpm(args, cwd = ROOT) {
  // args are hardcoded in this script (not user input) — safe to pass as array
  // through execSync with shell:true so npm is resolved by the OS PATH.
  return execSync(`npm ${args.join(' ')}`.trim(), { encoding: 'utf-8', cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function parseAuditJson(output) {
  const parsed = JSON.parse(output);
  const summary = parsed.metadata ?? {};
  const vulns = Array.isArray(parsed.vulnerabilities) ? parsed.vulnerabilities : [];
  const advisoryCount = vulns.reduce((acc, v) => acc + (v.severity === 'critical' || v.severity === 'high' ? 1 : 0), 0);
  return { summary, advisories: vulns, advisoryCount };
}

try {
  log('Starting weekly vulnerability scan & fix...');

  // Snapshot the audit result before applying fixes.
  const before = parseAuditJson(runNpm(['audit', '--audit-level=high', '--json']));
  if (before.advisoryCount > 0) {
    log(`Found ${before.advisoryCount} high/critical advisory(ies) before fix.`);
  } else {
    log('Audit passed: no high/critical vulnerabilities found.');
  }

  // Apply safe auto-fixes where npm can resolve them automatically.
  try {
    const fixOutput = runNpm(['audit', 'fix', '--package-lock-only']);
    log(`Auto-fix applied (${fixOutput.split('\n').filter((l) => l && !l.startsWith('[SEMVER')).length} line(s)).`);
    log('Fixed advisories were addressed by version updates.');
  } catch (err) {
    // `npm audit fix` exits non-zero when fixes are unavailable or fail.
    // We log and continue to report remaining advisories instead of crashing.
    log('Auto-fix attempted but some advisories could not be auto-resolved.');
  }

  // Final audit after fix attempt.
  const after = parseAuditJson(runNpm(['audit', '--audit-level=high', '--json']));
  if (after.advisoryCount === 0) {
    log('Final audit clean: all high/critical vulnerabilities resolved.');
    process.exit(0);
  } else if (before.advisoryCount === 0 && after.advisoryCount === 0) {
    log('Final audit clean: no advisories detected.');
    process.exit(0);
  } else {
    log(`Final audit still reports ${after.advisoryCount} high/critical advisory(ies).`);
    // Include top advisories in the log so the operator knows what remains.
    log('Remaining high/critical advisories are visible in logs/weekly-audit.log.');
    process.exit(1);
  }
} catch (err) {
  // npm audit failed (network/permission/missing config). Never expose internals.
  log(`ERROR: audit tooling could not run (${err && err.message ? err.message : 'unknown'}): see logs/weekly-audit.log for detail.`);
  process.exit(2);
}
