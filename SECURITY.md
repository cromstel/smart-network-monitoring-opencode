# Security Guidelines

## Overview

This document outlines the security requirements for the Smart Network
Monitoring application, and how to report a vulnerability in it.

## Reporting a Vulnerability

Report suspected vulnerabilities privately — open an issue only after a fix is
available. GitHub private vulnerability reporting is enabled on this repository;
use the **Report a vulnerability** button on the Security tab rather than a
public issue, a pull request, or a discussion.

Expect an acknowledgement within 72 hours and a severity assessment within 7
days. Fixes are prioritised by impact: anything allowing authentication bypass,
privilege escalation, or credential disclosure is treated as critical and
worked immediately.

## Supported Versions

Only the latest released version receives security updates. Upgrade as soon as
a new version is available rather than waiting for a maintenance window.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Authentication & Authorization

- All API endpoints require JWT-based authentication (session cookie `session`, `httpOnly: true`, `SameSite: lax` — never `localStorage`)
- Admin users have elevated privileges for system configuration
- Session tokens expire after 7 days (`maxAge: 7*24*60*60`) and are revoked server-side on logout (`POST /api/auth/logout` deletes DB session + clears cookie with `maxAge:0`)
- Role-based access control (RBAC) restricts feature access (`/api/auth/me` checks `VIEWER`/`MEMBER`/`ADMIN`)

## Data Protection

- Sensitive data (API keys, secrets) must be stored securely
- Database connections use encrypted transport (TLS 1.3)
- Personal data is anonymized before logging
- Regular security audits are conducted monthly

## API Security

- Rate limiting applied per endpoint and per IP (`createRateLimiter` in-memory, `x-forwarded-for` aware): login (`LOGIN_RATE_LIMIT_MAX`, default 5/15min), setup (5/60min). Admin endpoints still need limiters (pending).
- Input validation via Zod (`loginSchema`, `setupSchema`) before any DB write; `safeParse` used, flat-copied error details never expose internal state
- CSP (`Content-Security-Policy`) and security headers applied globally via `next.config.ts` (`headers()` on `/:path*`): `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`, `frame-ancestors 'none'`, `object-src 'none'`; plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`
- Auth form errors are generic (`"Invalid email or password"`) — never "email not found" / "invalid password" (prevents user enumeration)
- Autofill/demo-fill attributes removed from auth forms (`grep` zero hits); setup uses `autoComplete="new-password"`; login uses standard `username`/`current-password`

## Required Configuration

There are no built-in credentials, keys or identity values, in any environment —
including development. Every value below must be supplied, and the process
refuses to start without it.

| Variable | Required | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | always | 32+ characters. Keys the HMAC-SHA256 under which session-token hashes are stored (`lib/utils/crypto.ts`); rotating it invalidates every session. |
| `ENCRYPTION_KEY` | always | 32+ characters. Encrypts stored router credentials. |
| `APP_NAME` | always | Shown in the browser tab, sidebar and sign-in page. |
| `DB_NAME` | when `DB_CLIENT=mysql` | The schema to connect to. |
| `DB_USER` | when `DB_CLIENT=mysql` | The account to connect as. |
| `DB_PASSWORD` | when `DB_CLIENT=mysql` | Never defaulted to a usable value. |

Generate the two keys with `openssl rand -hex 32`. `lib/config.ts` validates all
of them at boot and reports every missing or weak value in one message.

An earlier version substituted literal `dev-only-insecure-*` defaults whenever a
secret was absent outside production, and defaulted the schema and user name to
`home_monitor` / `monitor`. Both are removed:

- a **usable default for a secret is a published key**, shared by every clone of
  this repository and every CI run that used it;
- a **default schema or user name** lets a deployment that forgot to configure
  one silently connect to whichever database and account happen to exist under
  that name — a wrong-database bug that looks like a working connection.

Because a default enforced only in production still allows a weak value to
travel from a developer's machine to staging to the production host, the
presence and length checks apply in **every** environment. The failure is raised
where the placeholder was written, not at the deploy that inherits it.

## Authentication Session Storage (critical change — documented 2026-10-25)

- Token is stored in an `httpOnly` cookie (`cookieStore.get('session')`) — never `localStorage`. The login POST (`app/api/auth/login/route.ts`) sets it; the logout POST (`app/api/auth/logout/route.ts`) reads from cookie, deletes DB session, then clears cookie (`maxAge: 0`, `httpOnly: true`, `sameSite: 'lax'`).
- `lib/api/auth.ts` (`getAuthContext` / `requireAuth`) validates session token against `validateSession` (hash comparison) before returning user context.
- No `localStorage.setItem('token', ...)` references exist in auth flow (verified by `grep`).

## Paid / Sensitive Sections

- Audit-plan: `.opencode/plans/plan-admin-features-2026-10-25.md` (done/pending checklist + API scope). Previous audit-plan `audit-and-resolve-all-gaps-2026-10-24.md` referenced but not present on disk; can be regenerated from checklist.
- Secret rotation: `DB_PASSWORD`, `SESSION_SECRET`, `ADMIN_PASSWORD`, `VIEWER_PASSWORD` in `.env.local` remain unrotated (pending deploy blocker — must rotate before any production deploy).

- PayStack API credentials are stored in environment variables only
- Secret keys are rotated quarterly
- Transaction amounts are validated against business limits
- Refund and charge operations require manual approval for amounts > $100

### Credentials are write-only

The PayStack secret and access token are never returned by `GET /api/settings`.
The response carries `paystackSecretSet` and `paystackAccessTokenSet` booleans
instead, so the dashboard can show whether a value is configured without the
value ever reaching the browser. This follows the same allow-listed projection
already used for the router password in `app/api/router-config/route.ts`.

The settings form exploits this: a blank credential input means "keep the stored
value", never "clear it". Only fields the operator actually types are sent, so
saving one field cannot overwrite another.

## Dashboard Settings

- Admin panel accessible only to users with ROLE_ADMIN
- Settings are persisted in the database with encryption at rest
- Changes are logged for audit trail
- Backup and recovery procedures are documented

## Compliance

- GDPR compliant data handling
- Regular penetration testing

## Reporting a Bug That Is Not a Security Issue

File a regular issue. Anything involving credentials, authentication, or
privilege boundaries should go through the private reporting path above instead.
