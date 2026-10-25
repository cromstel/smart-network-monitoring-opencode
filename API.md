# Smart Network Monitoring — API Reference (updated 2026-10-25)

Verified endpoints: both **fetch** (GET / read) and **push** (POST / mutation / command) fully implemented and backed by DB / services — not stubbed.

## Auth (verified complete — no further change needed)

| Method | Endpoint | Fetch / Push | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | push | `loginSchema` (Zod), rate limiter (5/15min), `session` cookie `httpOnly`, generic error `"Invalid email or password"` |
| POST | `/api/auth/logout` | push | Reads `session` cookie, deletes DB session (`logout`), clears cookie (`maxAge:0`) |
| GET | `/api/auth/me` | fetch | `requireAuth` checks cookie → `validateSession` → returns `{user: {id, email, name, role}}` |

## Setup / Bootstrap (verified complete)

| Method | Endpoint | Fetch / Push | Notes |
|---|---|---|---|
| GET | `/api/setup` | fetch | `countUsers()` → `{setupComplete}` |
| POST | `/api/setup` | push | `setupSchema` (Zod: 12-char min password + complexity), aggressive rate limit (5/60min), creates first ADMIN |

## Admin (verified — rate limits still pending on some)

| Method | Endpoint | Fetch / Push | Notes |
|---|---|---|---|
| GET | `/api/admin/email-providers` | fetch | `findProviders()`; `smtpPass` stripped from response; `seedDefaultGmail()` |
| POST | `/api/admin/email-providers` | push | `upsertProvider()`; input validated via repo |
| GET | `/api/admin/vulnerability-alerts` | fetch | `findUnreadForUser(user.id)` |
| GET | `/api/admin/devices/static-ip` | fetch | DB-backed |
| POST | `/api/admin/devices/block` / `.../block/[id]` | push | Device block command |

## Alerts / Network Monitoring (verified — fetch + push)

| Method | Endpoint | Fetch / Push | Notes |
|---|---|---|---|
| GET | `/api/alerts` | fetch | `getUserAlerts(auth.user.id)`; `requireAuth` (`VIEWER`/`MEMBER`/`ADMIN`) |
| POST | `/api/alerts` | push | `createSchema` (Zod: `alertType` enum + `threshold` rules); creates alert rule |
| POST | `/api/alerts/vulnerability` | push | `notifyVulnerability()` via `notificationService`; requires body fields |
| GET | `/api/alerts/[id]` | fetch | By ID |

## Devices / Connections / Bandwidth (fetch verified)

| Method | Endpoint | Fetch / Push | Notes |
|---|---|---|---|
| GET | `/api/devices` | fetch | List; `deviceService` / repo-backed |
| GET | `/api/devices/[id]` | fetch | By ID |
| GET | `/api/devices/[id]/connection-logs` | fetch | Connection logs |
| GET | `/api/devices/[id]/bandwidth` | fetch | Bandwidth data |

## Notifications (fetch + push verified)

| Method | Endpoint | Fetch / Push | Notes |
|---|---|---|---|
| GET | `/api/notifications` | fetch | User notifications |
| GET | `/api/notifications/[id]` | fetch | By ID |
| POST | `/api/notifications/read-all` | push | Marks all read |

## Health / Overview / Events / Settings / Router / Scan

| Method | Endpoint | Fetch / Push | Verification status |
|---|---|---|---|
| GET | `/api/health` | fetch | Verified (route exists) |
| GET | `/api/overview` | fetch | Verified; aggregation from DB |
| GET | `/api/events` | fetch | Verified; event log |
| GET/POST | `/api/settings` | fetch + push | Placeholder fixed; write encrypted at rest |
| GET | `/api/router-config` | fetch | DB-backed; settings form uses allow-list projection |
| Internal | `scanJob` / `rollupJob` / `pruneJob` | push | Scheduled; must push results to DB (verify execution, not just schedule) |

## Security measures applied to API layer (2026-10-25)

- **Cookie storage**: `session` cookie `httpOnly`, `sameSite: 'lax'`, `secure` in production — never `localStorage`
- **Rate limits**: login (5/15min), setup (5/60min); others pending
- **Validation**: `z.object(...)` + `.safeParse()` before DB interaction; flat-copied errors never expose SQL or internal state
- **Safe errors**: auth returns generic message; admin errors return `apiError()` with code + message only; no stack traces to client
- **CSP / headers**: `Content-Security-Policy` (no `eval`, `self` sources), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`; applied globally via `next.config.ts`
- **Audit-plan**: `.opencode/plans/plan-admin-features-2026-10-25.md`
