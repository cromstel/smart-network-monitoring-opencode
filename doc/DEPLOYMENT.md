# Deployment

Self-hosted dashboard that discovers and monitors every device on your local
network. One installation watches one network.

> **Verified from scratch 2026-10-14** at commit `3258005`: a fresh clone
> following the quick start below (with `ENABLE_DB_MIGRATIONS_ON_BOOT=true`)
> came up healthy — MariaDB ready, migrations applied on boot, `/api/health`
> `ok`, `/setup` redirecting to a 200 form, and the ARP scanner reporting
> `cap_net_raw=eip` with successful (0-error) scan cycles inside the
> container. This guide is executed, not aspirational.

- [Prerequisites](#prerequisites)
- [Quick start with Docker](#quick-start-with-docker)
- [Environment variables](#environment-variables)
- [First run](#first-run)
- [Running without Docker](#running-without-docker)
- [Upgrading](#upgrading)
- [Backups](#backups)
- [Scanners](#scanners)
- [Troubleshooting](TROUBLESHOOTING.md)

---

## Prerequisites

| Requirement | Why |
|---|---|
| Docker 24+ with Compose | The supported install path |
| A network segment you are allowed to scan | The app sends ARP probes; some environments forbid it |
| Two 32+ character secrets | Refusing to boot without them is deliberate — see below |

Generate the secrets once and keep them. Rotating `ENCRYPTION_KEY` makes
existing router credentials unreadable, and rotating `SESSION_SECRET` signs
everyone out.

```bash
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # ENCRYPTION_KEY
```

---

## Quick start with Docker

```bash
git clone https://github.com/cromstel/smart-network-monitoring-opencode.git
cd smart-network-monitoring-opencode

cat > .env <<'ENV'
SESSION_SECRET=replace-with-openssl-rand-hex-32
ENCRYPTION_KEY=replace-with-openssl-rand-hex-32

NETWORK_SUBNET=192.168.1.0/24
SCANNER_MODE=arp
SCAN_INTERVAL_SECONDS=30
DATA_RETENTION_DAYS=30
LOG_LEVEL=info

# The bundled app service runs against the bundled `mariadb` service, and
# Compose requires these — the `${DB_PASSWORD:?set DB_PASSWORD}` style checks
# in docker-compose.yml fail fast with "set DB_PASSWORD" if any is missing.
# There is deliberately no default: a default that is itself a credential is
# how a password leaks. Generate strong values and keep them.
DB_NAME=home_monitor
DB_USER=monitor
DB_PASSWORD=replace-with-a-long-random-password
DB_ROOT_PASSWORD=replace-with-another-long-random-password

# Applies migrations at startup so the first-run /setup works. Without it the
# tables do not exist and /setup returns 500 — see "First run" below.
ENABLE_DB_MIGRATIONS_ON_BOOT=true
ENV

docker compose up -d --build app
```

Then open <http://localhost:9090> and create the admin account.

If host port 9090 is taken, prefix the command with a free port, e.g.
`APP_PORT=3100 docker compose up -d --build app`, and open
<http://localhost:3100> instead. `DB_PORT` is the host port for the database and
only matters for connecting to it from the host; the app reaches the database
over the Compose network as `mariadb`.

The Compose file grants `NET_RAW` so the ARP scanner works. Without that
capability the app logs one warning per cycle and falls back to the simulated
scanner, which invents devices — useful for a demo, misleading in production.

The bundled `app` service runs against MariaDB (the `mariadb` service starts
alongside it — the service is named `mariadb`, and `DB_CLIENT=mysql` in the
Compose file is the *driver/dialect* name, not the server). Only MySQL is
supported; SQLite has been removed.

---

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `DB_CLIENT` | `mysql` | `mysql` only — SQLite removed |
| `DB_FILE` | — | No longer used (SQLite removed) |
| `DB_HOST` | `localhost` | MySQL only |
| `DB_PORT` | `3306` | MySQL only |
| `DB_NAME` | `home_monitor` | MySQL only |
| `DB_USER` | `monitor` | MySQL only |
| `DB_PASSWORD` | *(empty)* | MySQL only |
| `SESSION_SECRET` | — | **Required in production**, 32+ characters |
| `ENCRYPTION_KEY` | — | **Required in production**, 32+ characters |
| `NETWORK_SUBNET` | `192.168.1.0/24` | CIDR passed to the scanner |
| `SCANNER_MODE` | `simulated` | `simulated`, `arp` or `asus` |
| `SCAN_INTERVAL_SECONDS` | `30` | 30–3600 |
| `DATA_RETENTION_DAYS` | `30` | 1–365, enforced by the nightly prune |
| `NODE_ENV` | `development` | |
| `PORT` | `9090` | |
| `LOG_LEVEL` | `info` | `fatal`…`trace`, or `silent` |
| `ENABLE_DB_MIGRATIONS_ON_BOOT` | — | `true` applies pending migrations at startup |

Invalid configuration fails at boot with a message naming the variable, not
three layers deep as a runtime `undefined`.

---

## First run

The quick start sets `ENABLE_DB_MIGRATIONS_ON_BOOT=true`, so the schema is
applied at startup and the steps below work on a fresh database. If you unset
it, run `docker compose exec app npm run db:migrate` once before opening the
app, or `/setup` returns 500 because the tables do not exist.

1. Open the app. Unauthenticated requests redirect to `/login`.
2. Follow **Create the admin account** to `/setup`.
3. `/setup` creates the first ADMIN and then refuses to run again — it
   returns `409` as soon as any user exists. It is intentionally reachable
   without a session, because the first account is the one that grants ADMIN;
   it is rate limited to five attempts per hour instead.
4. Sign in. The dashboard starts empty and fills in on the first scan.

Seeding optional demo data (12 devices, seven days of history):

```bash
npm run db:seed          # refuses to run if devices already exist
```

The seeded admin has **no usable password** by design. To explore the UI
without typing, create your own account through `/setup` on a fresh database.

---

## Running without Docker

```bash
npm ci
cp .env.example .env     # then edit it — SESSION_SECRET and ENCRYPTION_KEY
npm run db:migrate
npm run dev              # http://localhost:9090
```

Production:

```bash
npm run build
npm start
```

`instrumentation.ts` starts the scheduler on boot: the scan loop, the hourly
rollup and the nightly prune. It registers once per process and refuses to
start twice, so `next dev` hot reloads cannot stack duplicate jobs.

---

## Upgrading

MySQL is the only supported database for both development and production.

```yaml
services:
  mysql:
    image: mysql:8
    environment:
      MYSQL_DATABASE: home_monitor
      MYSQL_USER: monitor
      MYSQL_PASSWORD: ${DB_PASSWORD}
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
    volumes:
      - mysql-data:/var/lib/mysql
    healthcheck:
      test: ['CMD', 'mysqladmin', 'ping', '-h', '127.0.0.1']
      interval: 10s
      timeout: 5s
      retries: 10
```

Set `DB_CLIENT=mysql` and the `DB_*` values, then:

```bash
docker compose exec app npm run db:migrate
```

Byte counters are read as strings in both dialects, so a counter above
2^53 serialises exactly rather than being rounded by a float.

---

## Upgrading

```bash
git pull
docker compose up -d --build
```

Migrations are forward-only. Each migration has a `down`, but rolling back a
migration that has already run in production is not supported — take a backup
first.

Set `ENABLE_DB_MIGRATIONS_ON_BOOT=true` to have the app apply pending
migrations at startup; otherwise run `npm run db:migrate` explicitly as a
separate step so a failure is visible rather than silent.

---

## Backups

MySQL:

```bash
docker compose exec mariadb mysqldump -umonitor -p home_monitor | gzip > backup.sql.gz
```

---

## Run it behind a reverse proxy

Terminate TLS at the proxy and forward to the container. Two settings matter:

- **Disable response buffering for `/api/events`.** Server-Sent Events is a
  long-lived stream; a buffering proxy will hold events until the buffer
  fills, and the dashboard will look frozen.
- **Raise the read timeout** for that route. The stream sends a keep-alive
  comment every 30 seconds, so a 60-second proxy timeout is sufficient.

nginx:

```nginx
location /api/events {
    proxy_pass http://127.0.0.1:9090;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}

location / {
    proxy_pass http://127.0.0.1:9090;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`X-Forwarded-For` matters: rate limiting keys on the first entry in that
header.

---

## Scanners

| Mode | Needs | Yields |
|---|---|---|
| `simulated` | nothing | Invented devices. For demos only. |
| `arp` | `CAP_NET_RAW` or root | Everything answering on the subnet |
| `asus` | a configured ASUS router | Router-reported clients, with signal strength |

Selection prefers the router, then ARP, then simulated, and logs one warning
naming what failed and what it fell back to.

Router credentials are encrypted with AES-256-GCM before they touch the
database (`iv:authTag:ciphertext`, hex-joined) and decrypted only at the
moment of use. No API response ever includes the field.

---

## Health

`GET /api/health` is unauthenticated by design so a load balancer can poll it.

```json
{
  "status": "ok",
  "scanner": { "mode": "arp", "lastScanAt": "2026-09-27T10:00:00.000Z", "lastScanStatus": "success" },
  "scheduler": { "scan": "scheduled", "rollup": "running", "prune": "running" }
}
```

`status` is `degraded` when the last scan cycle failed. `503` means the
database is unreachable.
