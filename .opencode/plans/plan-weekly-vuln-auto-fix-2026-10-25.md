---
name: plan-weekly-vuln-auto-fix
filename: plan-weekly-vuln-auto-fix-2026-10-25.md
description: Weekly automated vulnerability scan + auto-fix via cron (system cron default).
---

# Plan: Weekly Auto Vulnerability Check & Fix — 2026-10-25

## User Journey
As an operator, I want the server to scan for dependency vulnerabilities every week and apply safe auto-fixes automatically, so that advisories are addressed without manual intervention.

## Decisions
- Scheduler: system cron (not PM2 / GitHub Actions).
- Cadence: Mondays 02:00.
- Auto-fix: `npm audit fix` applied when safe; unfixable high advisories logged (exit 1) so the operator is alerted.
- No secrets exposed in logs; generic errors only; `logs/` kept out of git if needed.

## Tasks
- [x] Plan file created (this file).
- [x] Script `scripts/weekly-audit-fix.mjs` (audit + fix + report).
- [x] `package.json` `weekly-audit` script added.
- [x] Cron instruction `scripts/cron-weekly-audit.txt` written.
- [x] Script executed and verified (`npm audit` clean; exit 0).
- [x] Log directory `logs/` prepared (ignored, not committed).

## Acceptance Criteria
- `node scripts/weekly-audit-fix.mjs` exits 0 when audit passes / fixes applied.
- `npm audit` reports `found 0 vulnerabilities` after fix run.
- No secrets in script/log output.
- Crontab line documented and ready for `crontab -e`.
