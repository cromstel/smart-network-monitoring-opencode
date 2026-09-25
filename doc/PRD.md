# Product Requirements — Home Network Monitor

Version 2.0 · 2026-09-24 · Supersedes `NETWORK_MONITOR_PRD2.md` (v1.0, Feb 2026)

Changes from v1.0: PostgreSQL/Prisma replaced with MySQL/SQLite and a query builder; WebSockets replaced with SSE; authentication promoted from optional to required; multi-tenancy explicitly deferred; success metrics made measurable.

---

## 1. Summary

A self-hosted web application that discovers every device on a local network, tracks its bandwidth and connection history, and surfaces unknown or misbehaving devices. One installation monitors one network.

**Users:** home users, tech enthusiasts, and small-office administrators who want visibility into what is on their network without sending data to a third party.

**Core value:** *"What is connected to my network right now, what is it using, and should it be here?"*

---

## 2. Goals

| Goal | Measure |
|---|---|
| Real-time device visibility | New device appears in the dashboard within 30s of joining |
| Accurate bandwidth attribution | Per-device throughput within ±5% of router-reported values |
| Identify unknown devices | Every device is either user-named or flagged unknown; unknown triggers an alert |
| Useful history | 30 days of per-device metrics queryable in under 1s |
| Trustworthy | No credential stored in plaintext; nothing leaves the local network |

### Non-goals for v1.0
Deep packet inspection · QoS management · DNS filtering · firewall rules · cloud sync · native mobile apps · monitoring more than one network per installation · multi-tenant SaaS.

---

## 3. Personas

**Ana — home user.** Wants to know why the internet is slow and whether a neighbour is on her WiFi. Will not read documentation. Needs the dashboard to answer both questions on the first screen.

**Dev — enthusiast.** Runs it in Docker beside other services. Wants the API, the router integration, and control over retention.

**Sam — small-office admin.** 30–50 devices. Needs the device table, alerting on unknown devices, and an export for records.

---

## 4. Functional requirements

Priority: **P0** = v1.0 cannot ship without it · **P1** = v1.0 target · **P2** = post-1.0.

### 4.1 Device discovery
| ID | Requirement | Pri |
|---|---|---|
| F-01 | Periodically scan the local subnet and record every responding device | P0 |
| F-02 | Three interchangeable scanner backends: simulated, ARP, router API | P0 |
| F-03 | Resolve hostname via reverse DNS where available | P1 |
| F-04 | Resolve manufacturer from MAC OUI prefix, offline | P0 |
| F-05 | Detect a new device within 30s of connection | P0 |
| F-06 | Mark a device offline after 2 consecutive missed scans (min. 2 minutes) | P0 |
| F-07 | Degrade to a working scanner when the preferred one lacks privileges | P0 |

### 4.2 Device information
| ID | Requirement | Pri |
|---|---|---|
| F-10 | Display name, IPv4, MAC, type, manufacturer, status, first/last seen | P0 |
| F-11 | User-editable device name and type, persisted | P0 |
| F-12 | Cumulative connection time per device | P1 |
| F-13 | Signal strength (dBm) where the router reports it | P2 |
| F-14 | IPv6 address where available | P2 |

### 4.3 Bandwidth
| ID | Requirement | Pri |
|---|---|---|
| F-20 | Current up/down throughput per device, refreshed every 5–10s | P0 |
| F-21 | Cumulative bytes transferred per device since first seen | P0 |
| F-22 | Time-series history: 1h, 24h, 7d, 30d | P0 |
| F-23 | Peak throughput per device per day | P1 |
| F-24 | Top-N bandwidth consumers on the dashboard | P0 |

### 4.4 Alerts
| ID | Requirement | Pri |
|---|---|---|
| F-30 | Alert when an unrecognised device connects | P0 |
| F-31 | Alert when a device exceeds a user-set bandwidth threshold | P1 |
| F-32 | Alert when a named device goes offline | P1 |
| F-33 | Alerts persist in an activity log and can be acknowledged | P0 |
| F-34 | Alerts are scoped to the user who configured them | P0 |

> F-34 exists because a cross-user notification leak has occurred before on a related project: one user's threshold fired notifications for everyone. Scope every alert query by owner and cover it with a test.

### 4.5 Router integration
| ID | Requirement | Pri |
|---|---|---|
| F-40 | Store router credentials encrypted with AES-256-GCM | P0 |
| F-41 | ASUS router API client | P1 |
| F-42 | Fall back to ARP scanning when no router is configured | P0 |
| F-43 | Show DHCP lease times | P2 |
| F-44 | Block/unblock a device through the router | P2 |
| F-45 | TP-Link and Netgear clients | P2 |

### 4.6 Settings
| ID | Requirement | Pri |
|---|---|---|
| F-50 | Configurable subnet and scan interval (30s–1h) | P0 |
| F-51 | Configurable retention in days, **enforced by a pruning job** | P0 |
| F-52 | Notification preferences per alert type | P1 |
| F-53 | Dark/light theme | P1 |

### 4.7 Accounts and access
| ID | Requirement | Pri |
|---|---|---|
| F-60 | Local account with hashed password (bcrypt, cost ≥ 12) | P0 |
| F-61 | Session cookie: httpOnly, sameSite=lax, secure in production | P0 |
| F-62 | Roles: ADMIN, MEMBER, VIEWER — enforced in middleware **and** in each route handler | P0 |
| F-63 | First-run setup creates the initial ADMIN | P0 |
| F-64 | Password reset by email | P2 |

> F-62 says "and" deliberately. Middleware alone is not authorisation — a route handler must re-check the caller's role. Defence in depth.

---

## 5. Non-functional requirements

### Performance
- Dashboard first contentful paint under 2s on a warm cache
- Full network scan completes in under 30s for a /24
- History queries over 30 days return in under 1s
- 100 concurrent devices with no visible degradation

### Security
- AES-256-GCM for router credentials; key from `ENCRYPTION_KEY`, never committed
- bcrypt for passwords, cost ≥ 12
- All input validated with Zod at the route boundary
- Rate limiting on auth endpoints
- No secret in any log line or API response
- HTTPS in production (terminated at the reverse proxy is acceptable)

### Reliability
- Survives router unreachability without crashing; shows degraded state
- Data persists across restarts
- Scanner failure is logged and retried, never silent
- Scheduled jobs are idempotent — a double-run must not double-count

### Compatibility
- Chrome, Firefox, Safari, Edge — latest two versions
- Responsive from 360px to 2560px
- Runs on Linux, macOS, and Windows via Docker

---

## 6. Data model

Entities and relationships are specified in `docs/DATABASE.md`. In brief:

`Device` 1—* `BandwidthMetric` · 1—* `ConnectionLog` · 1—* `DeviceAlert`
`Device` *—1 `DeviceCategory`
`RouterConfig` (0 or 1 active)
`User` 1—* `Session`, 1—* `UserSettings`
`NetworkMetric`, `NetworkScanHistory` — network-wide, no device FK

---

## 7. Release criteria for v1.0

- [ ] `npm run build` succeeds with zero errors
- [ ] `npm run type-check` succeeds with zero errors
- [ ] All P0 requirements implemented and covered by a test
- [ ] Test suite green against **MySQL**, not only SQLite
- [ ] Unit coverage ≥ 70% on `lib/services/` and `lib/utils/`
- [ ] Playwright covers: login, device list, rename device, view history, configure alert
- [ ] No plaintext credential anywhere in the database
- [ ] Retention pruning verified to actually delete rows
- [ ] 24-hour soak run with no memory growth and no unhandled rejection
- [ ] `docs/DEPLOYMENT.md` reproduces a working install from scratch

---

## 8. Post-1.0

Phase 6 in `docs/PLAN.md`: multi-tenancy (organisations, plan tiers, billing) · anomaly detection · mobile apps · guest network management · speed-test integration · Home Assistant integration.
