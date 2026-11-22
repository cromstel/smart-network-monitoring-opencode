# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# The dependency set is pure JavaScript — mysql2, kysely, bcryptjs, pino and
# the rest all ship prebuilt — so `npm ci` compiles nothing and needs no
# toolchain. ca-certificates is kept because npm itself talks TLS.
COPY package.json package-lock.json ./
RUN npm ci

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The build validates configuration, so the secrets and DB identity must be
# present (and the secrets long enough) to satisfy the production guard. They
# are build-time only — real values are injected by the orchestrator at runtime
# (see the runtime stage) and never baked into the image. Nothing here is a
# usable credential: mysql2 pools are lazy, so the DB values are never used to
# connect, and `next build` imports every route to collect page data, which is
# the only reason the guard runs at all (`lib/db/client.ts` builds its pool at
# module scope via `requiredEnv('DB_USER' | 'DB_PASSWORD' | 'DB_NAME')`).
#
# APP_NAME is deliberately absent. Nothing that reads it is prerendered
# (`app/layout.tsx` is `force-dynamic`), so the build never sees it and the
# runtime value is the only one that exists. A placeholder here would be a
# second source of truth for the product's name — and the one that shipped.
#
# All of these are set inline on the RUN rather than in an ENV instruction.
# Docker's `SecretsUsedInArgOrEnv` check flags any ENV whose name looks like a
# secret (*PASSWORD, *SECRET, *KEY) even when the value is a throwaway
# placeholder, and an ENV is recorded in the layer's metadata; an inline
# assignment is scoped to this one command and leaves no trace in the image.
ENV NODE_ENV=production

RUN SESSION_SECRET=build-only-placeholder-secret-value-0000 \
    ENCRYPTION_KEY=build-only-placeholder-encryption-key-000000 \
    DB_CLIENT=mysql \
    DB_HOST=127.0.0.1 \
    DB_PORT=3306 \
    DB_NAME=build_only_placeholder \
    DB_USER=build_only_placeholder \
    DB_PASSWORD=build_only_placeholder \
    npm run build

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
    HOSTNAME=0.0.0.0 \
    SCANNER_MODE=arp \
    SCANNER_INTERVAL_SECONDS_UNUSED=0

# The listen port is an `ARG` so the built image carries no frozen port, and so
# the healthcheck, the EXPOSE and the server cannot disagree about it.
#
# There is no `DB_CLIENT` default and no database file: MySQL/MariaDB only,
# and the connection identity (DB_HOST, DB_NAME, DB_USER, DB_PASSWORD) is
# deployment configuration supplied at run time. Baking a database name into
# the image would be the same hardcoding `APP_NAME` was introduced to remove,
# with the product's name merely moved from a filename into a schema name.
ARG PORT=9090
ENV PORT=${PORT}

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/instrumentation.ts ./instrumentation.ts

# `next.config.ts` imports `./lib/config/ports` at load time, so that one
# file is a *runtime* dependency, not a build artifact. Omitting it produced an
# image that builds cleanly and then fails at container start, when `next start`
# loads the config and cannot resolve the import — the failure names a path
# inside the image and gives no hint that a COPY line is missing.
#
# `ports.ts` itself imports nothing, so copying the single file is enough; a
# recursive copy of `lib/` would pull the database layer and the scanners into
# the image for no reason.
COPY --from=build /app/lib/config/ports.ts ./lib/config/ports.ts

# Nothing in the image writes to /data any more — the database lives on the
# MySQL/MariaDB server named by the runtime environment — so there is no
# volume to declare and no directory to own beyond the app itself.
RUN chown -R node:node /app

USER node
EXPOSE ${PORT}

# Fail fast if the process is alive but the app cannot serve.
# `process.env.PORT` is set above from the same `ARG` the server listens on, so
# the healthcheck cannot probe a different port than the one being served.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps zombies and forwards signals so the scheduler shuts down cleanly.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start"]
