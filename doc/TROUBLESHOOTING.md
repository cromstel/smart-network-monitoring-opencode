# Troubleshooting

Symptom-first. Each entry starts with what you see.

---

## The app redirects to `/login` in a loop

The session cookie is not sticking.

- Behind a proxy, confirm `X-Forwarded-Proto` is set. The cookie is marked
  `secure` in production, so over plain HTTP the browser drops it and you are
  sent straight back to `/login`. Use HTTPS, or set `NODE_ENV=development`
  while testing.
- Confirm the cookie domain matches how you are reaching the app. Reaching
  the app as `localhost` but setting the cookie for a different host is the
  usual cause.

Check what the browser actually stored:

```
Application → Cookies → session
```

---

## "Insecure production configuration"

```
Insecure production configuration: SESSION_SECRET must be at least 32
characters in production (generate with: openssl rand -hex 32)
```

The app refuses to boot on a weak secret. Generate both:

```bash
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # ENCRYPTION_KEY
```

---

## Devices never appear

Work down this list.

**1. Is the scanner available?**

```bash
curl -s localhost:3000/api/health | jq '.scanner'
```

- `"mode": "simulated"` when you expected `arp` means the capability probe
  failed. The warning in the log names the reason: either `arp-scan` is
  missing, or it lacks `CAP_NET_RAW`.
- `consecutiveFailures` climbing means the scanner runs but errors.

**2. Does the container have `NET_RAW`?**

```bash
docker compose exec app sh -c 'getcap $(which arp-scan)'
```

No output means it cannot open raw sockets. Add `cap_add: [NET_RAW]` to the
service, or run privileged.

**3. Is the subnet right?**

`NETWORK_SUBNET` must be a CIDR, not a single address:

```
NETWORK_SUBNET=192.168.1.0/24     # correct
NETWORK_SUBNET=192.168.1.5       # will find nothing
```

**4. Is the host actually on that subnet?**

The container needs to share a network namespace with the devices. A macvlan
network, host networking, or running on the gateway itself. A container on a
bridge network sees the host's LAN segment, which is usually fine.

**5. Are the devices answering ARP at all?**

Sleeping phones and many IoT devices do not respond to unsolicited probes.
Expect a subset, not the whole network.

---

## Live updates freeze

The dashboard polls on a timer, so it degrades rather than breaks.

SSE sits behind `/api/events` and needs an unbuffered proxy. If the proxy
buffers, events arrive in bursts or not at all:

```nginx
location /api/events {
    proxy_buffering off;
    proxy_read_timeout 1h;
    proxy_set_header Connection '';
}
```

Check the indicator in the sidebar: a green dot is a live stream, grey is
reconnecting.

---

## The scheduler never runs

`GET /api/health` reports `scheduler.scan: null`.

`instrumentation.ts` must sit in the **repository root**. Next.js only loads it
from there (or from `src/` when using that directory). In `lib/` it is an
ordinary module that nothing imports, and no job ever starts.

It also stays down when `NODE_ENV=test` or when the runtime is not Node, both
intentional.

---

## Alerts never fire

- **No rule exists.** Alerts require a rule; the defaults create none. Add one
  under Alerts.
- **A global rule only matches new devices.** "Alert on any new device" fires
  the first time a MAC is seen. Devices discovered before the rule was created
  will not alert retroactively.
- **The rule is scoped to its owner.** Rules belong to the user who created
  them; another account will never see them, by design (PRD F-34).

---

## "Unknown device" alerts for devices I already know

The rule keys on the MAC. A device that changes IP is still known; one that
changes MAC — a randomised MAC per SSID, common on phones and laptops — looks
new every time. Disable MAC randomisation on those devices, or ignore the
category.

---

## Coverage or type-check fails in CI

```bash
npm run type-check
npm run test:coverage
```

The coverage gate is 70% statements and lines on `lib/services` and
`lib/utils`, per PRD §7. ts-jest does not type-check during tests (Jest's
`moduleNameMapper` owns `@/` resolution, and letting ts-jest apply `paths` as
well double-loads modules on Windows), so `type-check` is the stage that
catches type errors — including in test files.

---

## MySQL tests fail in CI but pass locally

The MySQL leg runs the same specs against MySQL 8. Failures there but not on
SQLite usually mean dialect divergence:

- `CAST(... AS UNSIGNED)` is MySQL-only; `CAST(... AS INTEGER)` is SQLite-only.
  `rollupJob` picks between them from `DB_CLIENT`.
- SQLite returns INTEGER columns as `bigint` under `defaultSafeIntegers`.
  `1n !== 1`, so booleans and counts must be normalised with `Number(...)`,
  the way `lib/db/repositories/mappers.ts` does.

Check the job log: it prints the driver error verbatim.

---

## Row values look wrong (0, false, or blank)

A repository is passing a SQLite `bigint` through unconverted. `1n === 1` is
false, so every boolean reads as off. Normalise numerically at the repository
boundary; do not compare raw driver values.

---

## Port already in use

```bash
docker compose ps                       # what holds it
lsof -nP -iTCP:3000 -sTCP:LISTEN        # on the host
```

Change `ports: - "3000:3000"` in the Compose file, or the `PORT` variable
when running without Docker.

---

## Logs

```bash
docker compose logs -f app
```

Structure is JSON. `password`, `token`, `secret`, `authorization` and
`cookie` are redacted at the logger, so a credential cannot reach a log line
by accident.

Raise verbosity with `LOG_LEVEL=debug`, or silence it with
`LOG_LEVEL=silent` when benchmarking.
