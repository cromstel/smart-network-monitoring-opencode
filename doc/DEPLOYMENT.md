# Deployment

Self-hosted dashboard that discovers and monitors every device on your local
network. One installation watches one network.

- [Prerequisites](#prerequisites)
- [Quick start with Docker](#quick-start-with-docker)
- [Environment variables](#environment-variables)
- [First run](#first-run)
- [Running without Docker](#running-without-docker)
- [MySQL instead of SQLite](#mysql-instead-of-sqlite)
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
ENV

docker compose up -d --build app
```

Then open <http://localhost:3000> and create the admin account.

The Compose file grants `NET_RAW` so the ARP scanner works. Without that
capability the app logs one warning per cycle and falls back to the simulated
scanner, which invents devices — useful for a demo, misleading in production.

The bundled `app` service runs against MySQL (the `mysql` service starts
alongside it). For the simpler SQLite path, drop the `app` service and use the
image directly — see [SQLite with plain Docker](#sqlite-with-plain-docker).

---

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `DB_CLIENT` | `sqlite` | `sqlite` or `mysql` |
| `DB_FILE` | `./data/dev.db` | SQLite path; mount its directory to persist |
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
| `PORT` | `3000` | |
| `LOG_LEVEL` | `info` | `fatal`…`trace`, or `silent` |
| `ENABLE_DB_MIGRATIONS_ON_BOOT` | — | `true` applies pending migrations at startup |

Invalid configuration fails at boot with a message naming the variable, not
three layers deep as a runtime `undefined`.

---

## First run

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
npm run dev              # http://localhost:3000
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

## SQLite with plain Docker

SQLite is the better default for a single-home install: no second container,
and the whole state is one file you can copy.

```bash
docker build -t home-network-monitor .

docker run -d \
  --name home-network-monitor \
  --restart unless-stopped \
  --cap-add NET_RAW \
  -p 3000:3000 \
  -v home-monitor-data:/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e NETWORK_SUBNET=192.168.1.0/24 \
  -e SCANNER_MODE=arp \
  home-network-monitor
```

The secrets are baked into the container's environment, which is fine for a
single host. For anything shared, use an env file or your orchestrator's
secret store rather than passing values on the command line, where they are
visible in `docker inspect` and shell history.

---

## MySQL instead of SQLite

SQLite is the right default for a single-home install. Move to MySQL when you
want the database on another host or alongside other tooling.

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

SQLite:

```bash
docker compose exec app node -e "
  const D=require('better-sqlite3');
  const db=new D('/data/home_monitor.db');
  db.exec(\"VACUUM INTO '/data/backup.db'\");
"
docker compose cp app:/data/backup.db ./backup-$(date +%F).db
```

Use `VACUUM INTO` rather than `cp`: copying a live SQLite file can capture a
torn page.

MySQL:

```bash
docker compose exec mysql mysqldump -umonitor -p home_monitor | gzip > backup.sql.gz
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
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}

location / {
    proxy_pass http://127.0.0.1:3000;
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
