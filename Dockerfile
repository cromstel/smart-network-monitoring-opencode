# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# better-sqlite3 and node-cron need a toolchain if a prebuilt binary is
# unavailable for the platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The build validates configuration, so the secrets must be present and long
# enough to satisfy the production check. They are build-time only — runtime
# values are injected by the orchestrator and never baked into the image.
ENV NODE_ENV=production \
    SESSION_SECRET=build-only-placeholder-secret-value-0000 \
    ENCRYPTION_KEY=build-only-placeholder-encryption-key-000000

RUN npm run build

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# `arp-scan` powers the ARP scanner (PRD F-02). Without NET_RAW the container
# falls back to the simulated scanner, which is fine for a demo but not for
# real discovery. `setcap` below grants it the capability it needs.
#
# cap_net_raw ONLY. The kernel refuses to execve() a file whose file
# capabilities exceed the execing process's capability bounding set — execve
# returns EPERM — and cap_net_admin is not in Docker's default capability set.
# A cap_net_admin-carrying binary therefore cannot start at all unless every
# deployment also adds `cap_add: [NET_ADMIN]`, and the failure is invisible to
# `getcap`, which still reports the caps as present. (Verified in a running
# container: exec EPERM with and without `cap_add: NET_RAW`; exec succeeds
# with `cap_add: NET_ADMIN` or with the grant reduced to cap_net_raw.)
# Raw sockets — all arp-scan needs — require NET_RAW alone, and NET_RAW is in
# Docker's default set plus docker-compose.yml's explicit `cap_add`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends arp-scan libcap2-bin ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && setcap cap_net_raw+eip /usr/sbin/arp-scan

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DB_CLIENT=sqlite \
    DB_FILE=/data/home_monitor.db \
    SCANNER_MODE=arp \
    SCANNER_INTERVAL_SECONDS_UNUSED=0

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --from=build /app/instrumentation.ts ./instrumentation.ts

# Persist the SQLite database outside the image layer.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]

USER node
EXPOSE 3000

# Fail fast if the process is alive but the app cannot serve.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps zombies and forwards signals so the scheduler shuts down cleanly.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start"]
