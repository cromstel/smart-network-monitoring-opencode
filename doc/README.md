# Documentation

Home Network Monitor — a self-hosted dashboard that discovers and monitors every device on a local network.

These nine documents are the single source of truth. Any `.txt` status file or installer script in the repository root predates them and should be deleted (`AUDIT.md` A-19, A-20).

---

## Read in this order

| # | Document | What it answers |
|---|---|---|
| 1 | **[MEMORY.md](MEMORY.md)** | Where the project stands, what is decided, what must never be broken. **Read first, every session.** |
| 2 | **[AUDIT.md](AUDIT.md)** | What is wrong with the code today. 20 findings, 4 blockers. |
| 3 | **[PRD.md](PRD.md)** | What we are building and how we know it is finished. |
| 4 | **[ARCHITECTURE.md](ARCHITECTURE.md)** | How the system is put together and why. |
| 5 | **[PLAN.md](PLAN.md)** | Seven phases, each with a definition of done. |
| 6 | **[TODO.md](TODO.md)** | The ordered backlog. Work top to bottom. |
| 7 | **[IMPLEMENTATION.md](IMPLEMENTATION.md)** | Conventions, patterns, code examples, definition of done. |
| 8 | **[DATABASE.md](DATABASE.md)** | Schema, indexes, dialect differences, retention. |
| 9 | **[API.md](API.md)** | Every endpoint, payload, and role requirement. |
| 10 | **[TESTING.md](TESTING.md)** | What to test, at which layer, and the tests that must exist. |

---

## Current state, in one paragraph

There is a substantial and well-structured Next.js codebase here — 20 API routes, 9 pages, 30 components, 14 services. It does not build. Two pairs of routes collide, Prisma and PostgreSQL are still wired through nine files despite the decision to use MySQL and SQLite, the Prisma schema has no datasource URL, and the test suite has no runner installed. Phase 0 in `PLAN.md` closes those four. Nothing downstream is worth starting until it does.

---

## For an agent picking this up cold

```
1. Read MEMORY.md — especially §2 (constraints) and §4 (current state)
2. Read AUDIT.md — understand why the build fails before changing anything
3. Open TODO.md, take the top unticked task
4. Follow IMPLEMENTATION.md §1 for the working rhythm
5. Tick the task; if a decision changed, add a line to MEMORY.md §5
```

Do not batch tasks. One task, verified, then the next.

---

## The three things most likely to go wrong

**Reintroducing Prisma or PostgreSQL.** They are removed deliberately: the Prisma binary CDN is unreachable in this environment, and the generated types had leaked into React components. `MEMORY.md` §2.

**Cross-user alert leakage.** Every alert and notification query must filter by owner. A version of this bug has shipped before on a related project — one user's bandwidth threshold fired notifications for everyone. The negative test gets written before the feature (`TODO.md` B-51).

**SQLite/MySQL dialect drift.** Development on SQLite and production on MySQL means bugs that only appear after deploy. `ARCHITECTURE.md` §4 lists the specific divergences; CI runs the integration suite against real MySQL for this reason. If the team would rather not carry that risk, running MySQL in Docker for development removes it entirely.

---

## Quick reference

```bash
npm run dev            # SQLite, simulated scanner
npm run build
npm run type-check
npm test
npm run test:mysql     # integration suite against MySQL in Docker
npm run test:e2e
npm run db:migrate
npm run db:seed        # 12 devices, 7 days of history

docker compose up -d   # MySQL 8 for parity testing
```

Configuration: copy `.env.example` to `.env`. Every variable is documented in `ARCHITECTURE.md` §7 and validated at startup — a missing one fails immediately with a message naming it.
