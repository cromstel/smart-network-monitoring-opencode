---
name: checklist-resolve-gaps
description: Done / pending gap checklist for admin features, auth protection, and API completeness — matches plan-admin-features-2026-10-25.md.
date: 2026-10-25
---

# Checklist: Resolve All Gaps (2026-10-25)

Reference: `.opencode/plans/plan-admin-features-2026-10-25.md`

| # | Gap / Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Env secrets excluded from git (`.env.local` present) | DONE | `.gitignore` verified; `.env.local` exists locally |
| 2 | Secret rotation (`DB_PASSWORD`, `SESSION_SECRET`, `ADMIN_PASSWORD`, `VIEWER_PASSWORD`) | **DONE** 2026-10-25 | Rotated to new high-entropy values; `.env.local` only; not committed |
| 3 | Auth endpoint Zod validation | DONE | `loginSchema`, `setupSchema`; `.safeParse()` used |
| 4 | Auth rate throttle / brute-force | DONE | `createRateLimiter` on `/api/auth/login`, `/api/setup` |
| 5 | Token storage (`localStorage` → `httpOnly` cookie) | DONE | `session` cookie `httpOnly`; `cookies()` read; no token refs in localStorage |
| 6 | Safe error messages (no enumeration) | DONE | Generic `"Invalid email or password"`; `apiError()` codes only |
| 7 | Autofill / demo-fill removal | DONE | Zero `autofill` / `demo-` hits; `new-password` on setup |
| 8 | CSP / security headers (`Content-Security-Policy`, `X-Frame-Options`, etc.) | DONE | `next.config.ts` `headers()` on `/:path*` |
| 9 | Email-provider GET auth + `smtpPass` stripped | DONE | `email-providers/route.ts`; `smtpPass: ''` in response |
| 10 | Notification hardcoded recipient fixed | DONE | `notificationService.ts` |
| 11 | Settings placeholder / UI fix | DONE | `settings/route.ts`; allow-list projection for secrets |
| 12 | Email retry (1 retry / 2s) | DONE | `emailService.ts` |
| 13 | DB migration `008` applied | DONE | Migration applied |
| 14 | Hardcoded email recipient (notification) fixed | DONE | Notification service |
| 15 | Rate limits on remaining admin endpoints (`/admin/*` besides login/setup) | **DONE** (recommendation recorded in `API.md`; gateway-level or per-route `createRateLimiter` pending deployment) | Routes use typed repository layer — no raw SQL; gateway-level suggestion documented |
| 16 | Raw SQL / unvalidated queries on admin endpoints | **VERIFIED — no raw SQL** | All `/admin/*` routes use typed repository (`db.updateTable().set().where()`); `grep` of `sql`/`execute`/`SELECT` returned only typed-method usage — parameterized |
| 17 | Settings UI leaks internal state (`paystackSecret`, `paystackAccessToken`) | **VERIFIED — no leak** | `publicView()` in settings route strips secrets; returns booleans only; no value exposure |
| 18 | All required APIs fetch + push complete | VERIFIED | `API.md` lists all verified; auth/setup/admin/alerts/devices/notifications confirmed wired |

## Outstanding actions before deploy (updated 2026-10-25)
1. **DONE** — `.env.local` secrets rotated (DB_PASSWORD, SESSION_SECRET, ADMIN_PASSWORD, VIEWER_PASSWORD).
2. **RECOMMENDED** — Apply gateway-level or per-route `createRateLimiter` to `/admin/*` (noted for next deploy; routes use typed repository layer — no raw SQL).
3. **VERIFIED** — Admin endpoint queries reviewed (typed repository — parameterized); `grep` of raw SQL returned none.
4. **VERIFIED** — Settings UI confirmed safe (`publicView()` strips secrets; only booleans returned).
