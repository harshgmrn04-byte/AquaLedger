# Smart Water Sub-Meter Platform: Build Plan v2 (zero-cost, production-grade)

**Audience:** the coding agent (OpenAI Codex) acting as a new joiner on a production team.
**Status:** this file is the source of truth. It supersedes `WATER_METERING_BUILD_INSTRUCTIONS.md`.
If your instinct conflicts with this file, follow this file and log the disagreement in `docs/QUESTIONS.md`.
**Revision v2.1:** adds Redis (Upstash free tier when deployed, Redis in Docker locally) as an optional, fail-open cache and rate-limit store. Redis is never used for jobs.

---

## 0. Mission and how to work

### 0.1 Mission
Build a multi-tenant water-metering platform for apartment societies: smart sub-meters publish readings over MQTT, the backend stores them efficiently, bills each flat, detects leaks and explains bills. It is a **portfolio project for a full-stack job application**. It must run **entirely on free tiers (₹0)**, look like production work, and produce **measured, defensible numbers** for the owner's resume.

### 0.2 Why measurement matters
Every number on the owner's resume must trace to a saved benchmark file with a recorded baseline and hardware fingerprint. An improvement without a recorded "before" is worthless. Build the naive version first, measure it, tag it, then build the real one.

### 0.3 Rules of engagement
1. Work in the order given. Do not start a week until the previous week's gate checklist passes.
2. One task, one branch, one pull request (or one focused commit series). Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `perf:`).
3. Run `make verify` (lint, type-check, unit and integration tests) before you claim a task is done. Paste the result summary in the commit or PR description.
4. Do not add a dependency that is not listed in section 3 without writing an ADR (`docs/adr/`). Pin exact versions.
5. Check the **current official documentation** of a library before using its API. Do not rely on memory. Versions change.
6. **Never fabricate** results, benchmark numbers, sources, or test outcomes. If something cannot be measured or verified, say so in `docs/QUESTIONS.md` and stop that task.
7. Do not change a requirement, threshold, or schema silently. If a requirement is wrong or impossible, write an ADR proposing the change and stop for the owner.
8. Write tests that would **fail** if the behaviour were wrong. Do not write tests that merely mirror the implementation.
9. Keep the code readable. The owner will re-implement every module in their own words to defend it in interviews. Small modules, clear names, strict TypeScript, short comments that explain **why**.
10. Never commit secrets, `.env` files, real personal data, or benchmark results that were not produced by the harness.

### 0.4 Task loop (follow for every numbered task)
1. Re-read the task and its acceptance criteria.
2. Write a short plan (5 to 10 lines) at the top of the branch's first commit message or in `PROGRESS.md`.
3. Write the failing test first when the logic is non-trivial (domain functions, SQL, idempotency, security).
4. Implement the smallest thing that satisfies the acceptance criteria.
5. Run `make verify`. Fix failures properly (never by deleting or weakening tests).
6. Update docs (`docs/DESIGN_NOTES.md` for a new module; ADR for a decision).
7. Append an entry to `PROGRESS.md`.
8. Commit.

### 0.5 Stop and ask the owner (write to `docs/QUESTIONS.md`, then stop that task)
- A free-tier limit blocks the design, or a service's terms or pricing appear to have changed.
- You need an account, API key, or credential.
- A library's documented behaviour contradicts this file.
- A benchmark result looks implausible (for example 10x better than expected).
- You are about to delete or rewrite existing data, migrations already applied, or benchmark results.
- Anything under "Human checkpoints" below.

### 0.6 Human checkpoints (the owner must act)
- Create accounts: Supabase, Render, HiveMQ Cloud, Upstash (never add a payment method), Groq, GitHub repo, Cloudflare/GitHub Pages (landing page).
- Provide secrets (as environment variables, never in the repo).
- Review the simulator's realism and the leak scenarios (Week 1 and Week 3).
- Spot-check 20 judged LLM evaluation cases (Week 4).
- Record the 60 to 90 second demo video (Week 4).
- Approve the final resume bullets (Week 4).

### 0.7 Mistakes coding agents commonly make (do not do these)
- Optimising before recording a baseline.
- Claiming a benchmark improvement from a single run or a noisy machine.
- Using floating point for money.
- Trusting client-supplied tenant IDs.
- Setting row-level-security context outside a transaction (it leaks between pooled connections).
- Unbounded in-memory buffers (the deployed instance has 512 MB).
- Queries without a time-range predicate on partitioned tables.
- Writing `TODO` and moving on. Open a task in `docs/QUESTIONS.md` instead.
- Over-engineering: adding abstractions, layers or services this file does not call for.

---

## 1. Product definition

**Itch (Razorpay "Fix My Itch"):** "Why don't apartments have smart water sub-meters?"

**Users**
- **Society admin:** sees building-wide usage, unaccounted water, alerts, runs billing.
- **Resident:** sees own flat's usage and bills, and asks "why is my bill high?".

**Features**
1. Meters (simulated) publish cumulative readings over MQTT.
2. Ingestion validates, deduplicates and batch-writes readings with at-least-once delivery and idempotent storage.
3. Time-partitioned raw storage plus incremental, late-data-safe rollups serve fast dashboards, with automated retention.
4. Billing engine: tiered slabs, shared-cost allocation, itemised bills, idempotent runs.
5. Leak detection and mass-balance (main meter vs sum of flat meters), alerts with lifecycle and escalation.
6. LLM bill explanation (Groq) with schema-constrained output and numeric verification.
7. React dashboard for both roles with live updates.
8. Redis read-through cache for rollup queries (rollup-aware invalidation) and shared rate limiting, with an in-memory fallback.

**Out of scope:** real hardware, real payments, real residents' data, mobile apps, multi-region. All data is **synthetic** and labelled so in the README.

### 1.1 Metrics and what the baseline is (record the baseline BEFORE the improvement exists)

| ID | Metric | Baseline (naive) | Final |
|---|---|---|---|
| B1 | Ingestion: sustained msgs/s with 0 loss | one INSERT per message, ack on receive | batched, ack-after-commit |
| B1 | Lost or duplicate stored readings under broker-restart and replay | naive pipeline | must be 0 |
| B2 | Dashboard query P50 and P95 (30 days, hourly, 200 flats) | queries on raw readings | queries on rollups |
| B3 | Storage for 90 days of dashboard-queryable history (MB) | all raw kept 90 days | raw 7 days + rollups 90 days |
| B4 | Billing under crash (duplicate or missing bills over N kill-restart runs) | non-idempotent loop | pg-boss idempotent run |
| B5 | Leak detection: precision, recall, detection delay (hours) | monthly-bill comparison and fixed threshold | streaming detectors |
| B6 | API P95 and throughput under k6 | first working API | optimised |
| B7 | Lighthouse performance, LCP | first dashboard | optimised |
| B8 | LLM numeric grounding rate, tokens, latency | ungrounded prompt | verifier + fallback + cache |
| B10 | Rollup refresh time after late data | full recompute of the range | dirty-bucket incremental |
| B11 | Rollup endpoint P50 and P95, req/s, Redis commands per request | cache disabled | Redis read-through cache |
| T1 | Cross-tenant reads (database and cache) in adversarial tests | not applicable | must be 0 |
| T2 | Billing reconciliation error | not applicable | must be 0 (exact to the paisa) |

(Compression is **not** available on the free database, so there is no compression metric. Do not claim one.)

---

## 2. Hard constraints: zero cost

Nothing may require a credit card or payment. Verify each limit on the provider's current pricing page before relying on it, and log changes in `docs/QUESTIONS.md`.

| Service | Use | Known limits (verify) | Design consequence |
|---|---|---|---|
| Supabase Postgres (free) | Database only | 500 MB per project; pauses after 7 days of inactivity; shared pooler | Keep demo data small; weekly keep-alive; use **session pooler** (IPv4, port 5432) for the persistent server |
| Render free web service | The single backend process (API + SPA + ingest + worker + simulator) | 512 MB RAM, 0.1 CPU; sleeps after about 15 minutes idle; cold start 30 to 60 s; limited free bandwidth | Single process; bounded memory; cold-start UX; catch-up jobs; do not try to defeat the sleep |
| HiveMQ Cloud free | MQTT broker for the **deployed demo** | 100 connections; 10 GB/month; no SLA | Demo only; low message rate; TLS on 8883 |
| Upstash Redis (free) | Cache and shared rate limiting when **deployed** | 256 MB; 500K commands/month; one free database per account; TLS on by default; upgrades to pay-as-you-go only if a payment method is added | **Never add a payment method.** Cache and rate limits only (never per-message work); command budget guard; fail-open |
| Mosquitto (Docker, local) | MQTT broker for **local development and benchmarks** | none | All headline numbers come from local runs |
| Groq free tier | LLM | rate limits per model | Cache aggressively; evaluation runs must use cached responses and back off |
| GitHub Actions and GitHub Pages | CI and landing page | free for public repos | Repo is public |

**Design principle: the free server sleeps and has almost no CPU.** Therefore:
- All scheduled jobs must be **catch-up safe** (idempotent scans from a checkpoint, never "run exactly at 02:00").
- Partition maintenance and retention run in the database via **pg_cron** (works while the server sleeps).
- The simulator is deterministic and **backfills** the sleep gap on wake.
- Benchmarks run locally. The deployed demo is a showcase, not a benchmark target.
- Redis runs on a command budget (about 16K commands a day on the free quota). Use it for cache and rate limiting only, and fall back to memory if it is unavailable or the budget is nearly spent.

---

## 3. Final stack (do not deviate without an ADR)

| Layer | Choice |
|---|---|
| Language | TypeScript (strict), Node.js LTS, pnpm workspaces |
| Frontend | React, Vite, React Router, TanStack Query, Tailwind CSS, Recharts |
| API | Express (current major), Zod validation, helmet, express-rate-limit with `rate-limit-redis` (in-memory fallback), cookie-parser, pino and pino-http, `@asteasolutions/zod-to-openapi` for docs |
| Auth | argon2, `jose` for JWT, rotating refresh tokens stored hashed with reuse detection |
| Database | Supabase Postgres: native partitioning with pg_partman, pg_cron, row-level security |
| DB access | `pg` plus Kysely; SQL migrations with `node-pg-migrate` |
| Jobs | **pg-boss** (Postgres-backed queues; Redis is not used for jobs) |
| Cache and rate limiting | **Redis** via `ioredis`: Redis in Docker locally, **Upstash free tier** when deployed (verify Upstash connection settings in its docs). Optional adapter with an in-memory fallback |
| Device messaging | MQTT with the `mqtt` client; Mosquitto locally, HiveMQ Cloud when deployed |
| LLM | Groq via `groq-sdk` (OpenAI-compatible); structured outputs; Zod re-validation |
| Testing | Vitest, Supertest, Testcontainers (or the local compose DB), fast-check, Playwright, k6, axe |
| Tooling | ESLint, Prettier, `dependency-cruiser` (module boundaries), Husky and lint-staged, Makefile |
| CI/CD | GitHub Actions; Render auto-deploy from `main`; migrations run from CI |
| Metrics | prom-client at an internal `/metrics` (token-protected), pino JSON logs |

---

## 4. Architecture

### 4.1 One codebase, switchable roles
The server is a **modular monolith**. A single process can run any subset of roles, chosen by `ROLES` (comma separated):
- `api`: HTTP API, SSE stream, serves the built React app
- `ingest`: MQTT subscriber and batch writer
- `worker`: pg-boss workers (rollups, billing, detection, alerts)
- `simulator`: synthetic meter fleet publishing to MQTT

**Deployed (Render free):** `ROLES=api,ingest,worker,simulator` in one process.
**Local benchmarks:** run roles separately where useful (for example `ROLES=ingest` alone for the ingestion benchmark).

### 4.2 Data flow
```
Simulator --MQTT QoS1--> Broker --> Ingest --(buffer, batch, ack after commit)--> Postgres (readings_raw, partitioned)
                                                         |--> rollup_dirty (bucket marks)
pg-boss worker: rollup.recompute --> usage_hourly / usage_daily / building_hourly
pg-boss worker: detect.scan --> alerts --> alert.escalate (delayed job)
pg-boss worker: billing.run --> billing_runs / bills / bill_items
Browser --HTTPS--> Express (SPA + /api/v1) --> Redis cache (tenant-scoped keys, fail-open) --> Postgres (RLS, transaction-local tenant context)
Express --> SSE stream --> Browser (live usage, alerts)
Express --> Groq (explain) with verifier, cache and template fallback
```

### 4.3 Module map (each is a folder under `apps/server/src/modules/`)
`auth`, `tenancy`, `catalog` (societies, flats, meters), `ingest`, `readings`, `rollups`, `billing`, `detection`, `alerts`, `explain`, `simulator`, `live` (SSE), `admin` (health, demo reset, db size).

**Boundary rule:** a module may import another module **only through its `index.ts` public API**. Enforced by `dependency-cruiser` in CI. Layering inside a module: `routes → controller → service → repository`. Only repositories talk to the database. Only services contain business rules. Controllers parse input, call one service method, shape the response.

---

## 5. Repository structure

```
water-metering/
  AGENTS.md                      # short pointer to this file + the 10 rules of section 0.3
  WATER_METERING_BUILD_PLAN_v2.md
  README.md  RESULTS.md  RESUME_BULLETS.md  PROGRESS.md  CHANGELOG.md
  Makefile  package.json  pnpm-workspace.yaml  tsconfig.base.json
  .editorconfig  .gitignore  .env.example  .nvmrc
  render.yaml                    # Render blueprint (infrastructure as code)
  .github/
    workflows/ ci.yml  deploy.yml  keepalive.yml  nightly-bench-check.yml
    pull_request_template.md
  apps/
    server/
      src/
        main.ts                  # bootstrap: config, roles, graceful shutdown
        config/                  # env schema (Zod), fails fast on boot
        platform/                # logger, db pool, pg-boss, mqtt client, redis cache adapter, http server, metrics, errors
        modules/                 # see 4.3
        http/                    # middleware: request-id, auth, tenant context, rate limit, error handler
      test/                      # integration tests
      Dockerfile
    web/
      src/ app/ routes/ features/ components/ lib/ styles/
      e2e/                       # Playwright
  packages/
    shared/                      # Zod schemas, DTO types, constants, money helpers
    db/
      migrations/                # forward-only .sql files
      seeds/                     # synthetic society seeding
      src/                       # Kysely types and helpers
  tools/
    simulator-core/              # pure deterministic generator (no I/O)
    bench/
      harness/                   # runner, stats, fingerprint, compare, immutability check
      scenarios/                 # YAML scenario files
      naive/                     # naive baseline implementations (kept forever, used for comparisons)
      results/                   # append-only JSON results
      BASELINES.md               # registry of recorded baselines (see section 8)
      INDEX.md                   # generated index of all results
  docs/
    architecture.md  DESIGN_NOTES.md  RUNBOOK.md  API.md  SECURITY.md
    QUESTIONS.md                 # blocked items and disagreements
    adr/ 0000-template.md  0001-...
  infra/
    docker-compose.yml           # local: supabase/postgres image (extensions), mosquitto, redis
    mosquitto/mosquitto.conf
    k6/                          # load scripts
```

**Conventions**
- Files under about 300 lines. One responsibility per file. No `utils.ts` dumping grounds.
- `kebab-case` files, `camelCase` variables, `PascalCase` types. SQL in `snake_case`.
- No default exports in the server. Named exports only.
- All timestamps are UTC `timestamptz`. Format in the browser only.
- All money is integer paise (`bigint`). All volumes are integer millilitres (`bigint`).

---

## 6. Engineering standards (production habits)

### 6.1 Configuration and secrets
- All config comes from environment variables, validated at boot with a Zod schema in `config/`. The process **fails fast** with a clear message if anything is missing or malformed.
- `.env.example` documents every variable (see Appendix A). Real values live only in Render, GitHub Actions secrets and the owner's local `.env`.
- Never log secrets, tokens, password hashes or full connection strings.

### 6.2 Logging and observability
- `pino` JSON logs. A request-id middleware assigns `x-request-id` and includes it in every log line.
- Log levels: `error` (needs action), `warn` (degraded), `info` (lifecycle), `debug` (off in production).
- `/api/v1/healthz` (liveness, no DB) and `/api/v1/readyz` (checks DB and, when enabled, broker). `/metrics` requires a bearer token.
- Counters and histograms (prom-client): messages received, written, deduplicated, rejected; buffer depth; batch latency; job durations; HTTP latency. The benchmark harness reads these.

### 6.3 Errors and validation
- Define an `AppError` hierarchy (`ValidationError`, `AuthError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `UpstreamError`). One error-handling middleware maps them to a consistent JSON shape `{ error: { code, message, requestId } }`. Never leak stack traces or SQL errors to clients.
- Validate **every** boundary with Zod: HTTP input, MQTT payloads, job payloads, LLM output, environment.

### 6.4 Reliability
- Every outbound call (Groq, broker, DB) has a **timeout**. Retries use exponential backoff with jitter and a retry cap. Never retry non-idempotent operations without an idempotency key.
- **Idempotency** is mandatory for ingestion, billing runs, alert creation and any job. Document the idempotency key of each in `docs/DESIGN_NOTES.md`.
- **Graceful shutdown:** on `SIGTERM`, stop accepting work, flush the ingest buffer, finish or release jobs, close pools, then exit. Test it.
- **Bounded memory:** every queue or buffer has a maximum size and applies backpressure when full. The deployed instance has 512 MB, so measure RSS and set `--max-old-space-size` accordingly.
- **Catch-up safety:** scheduled jobs scan from a stored checkpoint, so missing a tick (because the server slept) loses nothing.

### 6.5 Database rules
- Migrations are **forward-only** SQL files `NNNN_description.sql`. Never edit an applied migration; add a new one.
- Row-level security (RLS) and grants live in migrations.
- Use two roles: `app_rw` (used by the API, **must not** bypass RLS) and the owner/migration role (used only by migrations and CI). Confirm `app_rw` does not have `BYPASSRLS` in a test.
- **Tenant context must be set inside a transaction**, transaction-local, for every request:
  ```sql
  select set_config('app.current_society_id', $1, true);
  select set_config('app.current_user_id', $2, true);
  ```
  Implement one helper `withTenant(ctx, fn)` that opens a transaction, sets both values, runs `fn(tx)`, and commits. No repository may run a tenant query outside it.
- Never concatenate SQL. Parameters only (Kysely handles this).
- Every query on `readings_raw` includes a `ts` range predicate (partition pruning). Add a lint-style test that fails if a repository query on a partitioned table lacks one.
- Every list endpoint is paginated with a hard maximum page size.
- Index columns used in RLS predicates and foreign keys. Inspect important queries with `EXPLAIN (ANALYZE, BUFFERS)` and save the plan in `bench/results/` when it supports a metric.

### 6.6 Security checklist (all must be true by Week 4)
- Passwords hashed with argon2id. Login and demo endpoints rate-limited. Generic error messages on failed login.
- Access token 15 minutes. Refresh token in an httpOnly, Secure, SameSite=Lax cookie, rotated on every use, **reuse of an old refresh token revokes the whole family**.
- Same origin for SPA and API (Express serves the built app), so no CORS and no third-party-cookie problems.
- `helmet` with a Content-Security-Policy suitable for the SPA. Request body size limits.
- Device authentication for MQTT: per-meter or per-fleet credentials; the ingest service verifies that the topic's `societyId` and `meterId` exist and match the payload.
- pg-boss job payloads contain `societyId` and workers re-validate it. No job reads data without an explicit society scope.
- LLM calls never include another tenant's data. User text is treated as untrusted.
- Cache entries are keyed by society and role and never contain tokens or personal data. The adversarial tests cover the cache.
- `pnpm audit` has no unaddressed high or critical findings. Document any exception in `docs/SECURITY.md`.

### 6.7 Testing pyramid (all in CI)
- **Unit (Vitest):** pure domain code (interval computation, slab billing, allocation, detectors, verifier).
- **Property tests (fast-check):** money allocation sums to total; interval computation is invariant under duplicate and reordered input.
- **Integration (Vitest + Supertest + real Postgres):** repositories, RLS, ingestion with a real broker, jobs.
- **Chaos tests:** kill and restart ingest and worker mid-run; replay duplicate messages.
- **End-to-end (Playwright):** login, usage views, billing run, alerts, explanation.
- **Load (k6):** run locally, results saved by the harness.
- Coverage is a signal, not a goal: require tests for every bug fixed and every edge case in section 7.

### 6.8 Git, CI and releases
- Branches: `main` is always deployable. Feature branches `feat/<module>-<short-name>`. Squash-merge.
- CI (`ci.yml`) on every push and PR: install, lint, type-check, dependency-cruiser, unit and integration tests (Postgres service container), build web and server. E2E runs on PRs to `main`.
- `deploy.yml` on `main`: run migrations against the production database (secret `DATABASE_URL_MIGRATIONS`), then trigger the Render deploy hook, then run the post-deploy smoke test.
- Tag baselines (`bench/<id>-baseline`) and releases (`v1.0.0`). Keep a `CHANGELOG.md`.
- Write an ADR for each significant decision (template in Appendix D).

### 6.9 Definition of done (every task)
Code merged to `main` branch via PR, tests added and passing, `make verify` green, docs updated, no new `TODO`s, `PROGRESS.md` updated, and, if the task produces a metric, the result file is saved by the harness and indexed.

### 6.10 Redis rules
- **Optional adapter.** Define a small `KeyValueStore` interface (get, set with TTL, increment with TTL) with two implementations: Redis (`ioredis`) and in-memory. If `REDIS_URL` is unset, the in-memory store is used and the app must behave correctly. Never delete by pattern or scan keys.
- **Fail-open.** Every Redis call has a short timeout (about 200 ms) and a low retry cap. A Redis error or timeout must never fail a request: treat it as a cache miss (or allow the request, for rate limiting), log a warning and count it in a metric.
- **Tenant-scoped keys.** Key format: `v1:{societyId}:{role}:{resource}:{paramsHash}:{cacheVersion}`. Never cache anything without a society scope. Never store tokens, password hashes or personal data in Redis.
- **Invalidation by version key.** Keep a per-society `cacheVersion` (a counter in Redis, mirrored in the Postgres `checkpoints` table) that the `rollup.recompute` job increments after it commits. Keys include the version, so stale entries are simply never read and expire through their TTL.
- **TTL on every entry** (`CACHE_TTL_S`) and a maximum value size.
- **Command budget.** The deployed Redis is the Upstash free tier (500K commands a month). Count every command in a metric (`redis_commands_total`), persist a daily total in `checkpoints`, and switch to the in-memory store when projected monthly use exceeds 80% of `REDIS_COMMAND_BUDGET_MONTHLY`. Use Redis for cache and rate limiting only; never for per-message work in the deployed demo.
- **Never** add a payment method to the Upstash account, and never use Redis for jobs (pg-boss does that).
- **Optional local experiment:** an ingest dedupe fast path (`SET NX` per `(meter_id, seq)` through a pipeline) benchmarked against plain `ON CONFLICT DO NOTHING`. **Keep it only if it improves the B1 numbers.** Otherwise delete it and do not claim it.

---

## 7. Database and queue specification

### 7.1 Core tables (simplified; write full DDL in migrations)
- `societies(id, name, timezone, created_at)`
- `users(id, society_id, flat_id null, email unique, password_hash, role, created_at)`; `refresh_tokens(id, user_id, family_id, token_hash, expires_at, revoked_at, replaced_by)`
- `flats(id, society_id, label, occupants)`; `meters(id, society_id, flat_id null, kind flat|main|common, device_credential_hash)`
- `readings_raw(society_id, meter_id, seq bigint, ts timestamptz, cumulative_ml bigint, battery smallint null, received_at timestamptz default now())`
  **partitioned by RANGE (ts)**, primary key and dedupe key `(meter_id, seq, ts)`.
  *The partition column must be part of every unique index.* The `ts` comes from the **device payload**, so a retransmitted duplicate carries the same `ts` and is deduplicated by the key.
- `rollup_dirty(meter_id, bucket_start)` (primary key on both)
- `usage_hourly(meter_id, bucket_start, society_id, flat_id, used_ml, readings, has_gap, has_reset, updated_at)`; `usage_daily` (same shape per day); `building_hourly(society_id, bucket_start, inlet_ml, flats_ml, common_ml, unaccounted_ml, coverage)`
- `tariffs`, `tariff_slabs(tariff_id, from_litres, to_litres null, paise_per_kilolitre)`, `shared_costs(society_id, period_start, kind, amount_paise, rule equal|proportional)`
- `billing_runs(id, society_id, period_start, period_end, status, started_at, finished_at, totals jsonb, unique(society_id, period_start))`; `bills(id, run_id, society_id, flat_id, total_paise, unique(run_id, flat_id))`; `bill_items(bill_id, kind, label, quantity, amount_paise)`
- `alerts(id, society_id, flat_id null, meter_id, kind, severity, dedupe_key, status open|acknowledged|resolved, opened_at, acknowledged_at, resolved_at, details jsonb)` with a partial unique index on `dedupe_key` where status is not resolved
- `explanations_cache(key_hash pk, society_id, flat_id, period, response jsonb, model, tokens_in, tokens_out, created_at)`
- `ingest_dead_letter(id, received_at, topic, payload, reason)`; `checkpoints(name pk, value jsonb, updated_at)`

### 7.2 Partitioning and retention
- Daily range partitions of `readings_raw` managed by **pg_partman**, with partitions pre-created a few days ahead. Maintenance and retention (`RAW_RETENTION_DAYS`, default 7 deployed, longer locally for benchmarks) are scheduled with **pg_cron** inside the database.
- Rollups outlive raw data. Dashboards must work from rollups alone beyond the raw retention window.
- Verify extension availability (`pg_partman`, `pg_cron`) at the start of Week 1. The local compose image must mirror the Supabase Postgres major version and extensions (use the `supabase/postgres` image; confirm).

### 7.3 Interval and rollup semantics (implement as pure functions in `readings`, with property tests)
- Consumption in a bucket = difference between the last cumulative reading at or before the bucket end and the last at or before the bucket start.
- **Counter reset:** if `cumulative_ml` decreases, treat the new value as consumption since a reset to zero and set `has_reset`.
- **Gap:** if sequence numbers jump, set `has_gap`; never treat a gap as zero consumption; expose `coverage`.
- **Late or out-of-order data:** ingestion upserts into `rollup_dirty` for each affected `(meter, hour)`. The `rollup.recompute` job recomputes **only dirty buckets from raw data** (idempotent upsert into `usage_hourly`, then `usage_daily` and `building_hourly`), then deletes the processed marks. Raw data older than retention cannot be recomputed; such late data is rejected and counted.
- Serve fresh dashboards as: rollups up to the watermark plus a live aggregate of raw data since the watermark.

### 7.4 pg-boss
- Connect with the **Supavisor session-mode** connection string (port 5432, IPv4-compatible). Do **not** use transaction mode (6543) for pg-boss or for `LISTEN`. Keep pool sizes small (API pool about 5, pg-boss about 3) because the free pooler has few connections. Verify in the docs.
- Queues: `rollup.recompute`, `billing.run`, `detect.scan`, `alert.escalate`, `maintenance.demo-reset`.
- Every job is idempotent. Use `singletonKey` (for example `billing:{societyId}:{periodStart}`) so duplicates collapse. Configure retries with backoff and a dead-letter behaviour. Payloads include `societyId`.
- Scheduled jobs (`detect.scan`, `rollup.recompute` sweep) read a checkpoint and process everything since, so a missed tick loses nothing.

### 7.5 Billing semantics
- Slab charges computed per flat from `usage_daily` for the period. Money in paise.
- Shared costs (tanker, common area) allocated by the configured rule using the **largest remainder method**, so the allocated amounts sum **exactly** to the shared total. Property-test it.
- A billing run is an idempotent state machine (`queued → running → completed | failed`) writing with upserts keyed by `(run_id, flat_id)`. Re-running never duplicates and a crashed run resumes.

### 7.6 Detection semantics
- **Night-flow rule:** flat usage above a small threshold during the quietest hours on K consecutive nights.
- **EWMA and z-score:** hourly usage per flat against its own smoothed baseline, with a persistence requirement (several consecutive hours) to limit false alarms.
- **Mass-balance rule:** building `unaccounted_ml` above a threshold for several consecutive hours.
- **Vacation suppression:** a flat with sustained zero usage and no leak signature is "away" and must not alert.
- A detector returns events behind a common `Detector` interface; the alert service deduplicates by `dedupe_key`.
- These are statistical methods. The README must describe them as such.

---

## 8. Baseline and benchmark protocol (the evidence for the resume)

### 8.1 Rules
1. **Baseline first.** For each metric, implement the naive version in `tools/bench/naive/`, run the benchmark, save the result, tag the commit `bench/<id>-baseline`, and register it in `tools/bench/BASELINES.md`. Only then build the optimised version. Keep the naive code forever so the comparison stays reproducible.
2. **Official runs** require a clean git state (no uncommitted changes) and the same machine configuration as the baseline.
3. **Repetitions:** 1 warm-up run then at least 5 measured runs. Report median, P95, min, max and standard deviation. If the coefficient of variation exceeds 10%, flag the run as noisy and repeat it.
4. **Machine state:** plugged in, no heavy applications running, Docker Desktop CPU and memory limits fixed and recorded.
5. **Seeds:** every simulator and benchmark run records its seed and scenario hash.
6. **Immutability:** result files are append-only. CI runs `tools/bench/harness/verify-immutable` and fails if an existing result file was modified or deleted.
7. **Comparisons** use `tools/bench/harness/compare <baselineId> <finalId>`, which refuses to compare runs with different scenario hashes or incompatible hardware fingerprints.
8. **No hand-edited numbers anywhere.** `RESULTS.md` and `RESUME_BULLETS.md` are generated from result files.

### 8.2 Environment fingerprint (saved in every result)
CPU model and cores, RAM, OS and version, Node version, Docker CPU and memory limits, Postgres version, extension versions, broker version, git commit, dirty flag, timestamp, scenario file hash, seed.

### 8.3 Scenario file
```yaml
name: ingest_5k_mps
seed: 42
meters: 5000
duration_s: 600
rate: { msgs_per_s: 5000 }
faults: { duplicate_rate: 0.02, out_of_order_rate: 0.01, drop_rate: 0.0, broker_restarts: 2, reconnect_storm: true }
leaks: []
```

### 8.4 Result file (`tools/bench/results/<id>/<timestamp>_<scenario>.json`)
```json
{
  "run_id": "B1_ingest_naive_001",
  "metric_id": "B1",
  "variant": "naive",
  "created_at": "ISO-8601",
  "scenario": "ingest_5k_mps",
  "scenario_hash": "...",
  "seed": 42,
  "fingerprint": { "cpu": "...", "cores": 0, "ram_gb": 0, "os": "...", "node": "...", "docker": {"cpus": 0, "mem_gb": 0}, "postgres": "...", "extensions": {}, "broker": "...", "git_commit": "...", "git_dirty": false },
  "repetitions": 5,
  "metrics": { "sustained_msgs_per_s": { "median": 0, "p95": 0, "min": 0, "max": 0, "stdev": 0 }, "lost": 0, "duplicates_stored": 0 },
  "notes": ""
}
```

### 8.5 Baseline definitions (exact)
- **B1 ingestion:** naive = per-message INSERT, PUBACK on receipt, no batching. Increase offered rate until loss or latency exceeds a threshold; record sustained msgs/s, loss and duplicates. Final = batched, ack-after-commit, bounded buffer. Chaos variant: broker restarts, ingest kills, duplicate replays.
- **B2 queries:** seed the same synthetic history (200 flats, 30 days). Naive = dashboard queries on raw readings (with partition pruning but no rollups). Save `EXPLAIN (ANALYZE, BUFFERS)` plans. Final = rollups plus live tail.
- **B3 storage:** footprint (MB) of 90 days of queryable history. Naive = all raw for 90 days. Final = 7 days raw plus rollups for 90 days. Measure with `pg_total_relation_size`.
- **B4 billing:** naive = loop that inserts bills without idempotency. Kill the worker at random points in N runs; count duplicate and missing bills. Final = pg-boss idempotent run; must be zero.
- **B5 detection:** ground-truth leak labels from the simulator. Baselines: (a) compare month-end usage against the previous month; (b) a fixed threshold. Metrics: precision, recall, false alerts per flat-month, median detection delay in hours. An alert matches a leak if it opens between the leak start and its end plus a tolerance window; record the tolerance.
- **B6 API:** k6 scenarios for login, usage queries and live stream; P50, P95, error rate, throughput.
- **B7 frontend:** Lighthouse (performance, LCP) on the dashboard, mobile profile, median of 5.
- **B8 explanation:** 50 synthetic flat-periods with known reasons. Naive = prompt with facts but no verifier. Final = structured output plus numeric verifier plus fallback plus cache. Metrics: numeric grounding rate, correct primary reason, P95 latency, tokens, cache hit rate. Cost is reported at **list price** from `configs/pricing.yaml` (the owner fills it in) because the free tier costs nothing; label it "list-price equivalent".
- **B10 rollups:** after injecting late data into M buckets, naive = recompute the entire range; final = dirty-bucket recompute. Record refresh time.
- **B11 cache:** same scenario and seed on the rollup endpoints. Naive = cache disabled. Final = Redis read-through cache. Record P50, P95, req/s, hit rate and Redis commands per request. The free quota is 500K commands a month, so also record the projected monthly commands under demo load. Add the functional results: cross-instance rate limiting and fail-open behaviour.
- **T1/T2:** pass/fail suites; record counts.

### 8.6 Baseline registry (`tools/bench/BASELINES.md`)
A table with: ID, variant, git tag, commit, result file, date, machine, notes. Add a row at the moment a baseline is recorded.

---

# WEEK 1: Foundations, ingestion, first baselines

**Goal:** a reliable ingestion pipeline proven under faults, plus baselines B1, B2, B3.

### Tasks
1. **Bootstrap the repo.** Create the structure in section 5: pnpm workspace, strict TypeScript, ESLint, Prettier, Husky, `dependency-cruiser` rules for module boundaries, Vitest, `Makefile` (`make up`, `make down`, `make verify`, `make bench ID=...`, `make migrate`, `make seed`), `.env.example`, `AGENTS.md`, empty docs. CI workflow running lint, types, tests.
   *Acceptance:* `make verify` passes on the empty skeleton and CI is green.
2. **Local infrastructure.** `infra/docker-compose.yml` with the Supabase Postgres image (confirm `pg_partman` and `pg_cron` exist), Mosquitto (persistent sessions, authentication enabled, QoS 1 friendly settings) and Redis (password-protected). Config module with Zod env validation. Logger and DB pool in `platform/`.
   *Acceptance:* `make up` starts services; server boots and `/api/v1/healthz` and `/readyz` respond; booting with a missing env var fails with a clear message.
3. **Migrations v1.** Extensions, roles (`app_rw` without BYPASSRLS), core tables, partitioned `readings_raw` with pg_partman, pg_cron job for maintenance, RLS policies and grants, `checkpoints`, `ingest_dead_letter`. Seed script for one synthetic society (about 30 flats, 1 main meter, 1 common meter, demo users).
   *Acceptance:* migrations apply from scratch and are re-runnable in a test; a test proves `app_rw` cannot read another society's rows and does not bypass RLS.
4. **Domain: interval computation** (`modules/readings`, pure functions). Implement section 7.3 semantics. Property tests: duplicates and reordering do not change results; resets and gaps flagged; total consumption conserved.
   *Acceptance:* tests cover reset, gap, duplicate, reorder, bucket boundary cases.
5. **Simulator core** (`tools/simulator-core`, pure and deterministic) and the MQTT publisher (`modules/simulator`).
   - Daily usage profiles (morning and evening peaks, weekday and weekend, household size), seeded.
   - Fault injection: duplicates, out-of-order, drops, clock drift, counter reset, broker restart, reconnect storm.
   - Leak injection (continuous low flow, burst, gradual drift, vacation (not a leak), common-pipe loss) with a **ground-truth label file**.
   *Acceptance:* the same seed produces byte-identical output; **pause for the owner to review realism.**
6. **Benchmark harness skeleton** (`tools/bench/harness`): fingerprint, runner with warm-up and repetitions, statistics, result writer, immutability check, compare tool, `INDEX.md` generator.
   *Acceptance:* a unit test runs the harness on a stub workload and writes a valid result file.
7. **Naive ingest and baseline B1.** Implement `tools/bench/naive/ingest-naive`. Run the scenarios, save results, tag `bench/B1-baseline`, add to `BASELINES.md`.
   *Acceptance:* result files exist for at least two rates and a chaos run.
8. **Production ingest** (`modules/ingest`).
   - Subscribe with a persistent session, QoS 1, and **manual acknowledgement**: send PUBACK only after the batch commits (check the `mqtt` client documentation for the option that delays acks).
   - Validate with Zod; invalid or unauthorised messages go to `ingest_dead_letter` (and are acknowledged so they do not loop).
   - Bounded buffer with backpressure; batch flush by size or time; multi-row insert with `ON CONFLICT DO NOTHING` on `(meter_id, seq, ts)`; write `rollup_dirty` marks in the same transaction.
   - Metrics and graceful shutdown that flushes the buffer.
   *Acceptance:* integration tests with a real broker prove zero loss and zero duplicates across at least 10,000 replayed messages with broker restart and ingest kill-restart. Save as `B1_ingest_final` chaos result.
9. **Seed history generator and baselines B2, B3.** A fast bulk generator for N days of history. Run the naive dashboard queries on raw data (B2) and measure the 90-day raw footprint (B3). Save results and plans; tag `bench/B2-baseline` and `bench/B3-baseline`.

### Week 1 gate
- [ ] `make verify` green; CI green
- [ ] RLS test passes; `app_rw` does not bypass RLS
- [ ] Ingest chaos test shows 0 lost and 0 duplicate stored readings
- [ ] Baselines B1, B2, B3 recorded, tagged and registered
- [ ] Owner has reviewed simulator realism

---

# WEEK 2: Rollups, auth, tenancy, API, dashboard v1, first deployment

**Goal:** fast dashboards, secure multi-tenant API, a usable React app, and a free deployment of this slice.

### Tasks
1. **Rollup pipeline** (`modules/rollups`). Implement section 7.3: `rollup.recompute` pg-boss job, dirty-bucket processing, late-data handling, "rollups plus live tail" read path. First implement the naive full-range recompute in `tools/bench/naive` and record **B10 baseline**; then the incremental version.
   *Acceptance:* a test compares rollup results with direct computation from raw data for random histories (property test); B10 baseline and final results saved.
2. **Partitioning, retention and re-measurement.** Confirm pg_partman maintenance and retention run via pg_cron. Re-run B2 (rollups) and B3 (retention plus rollups) with the same scenarios as the baselines.
   *Acceptance:* result files reference the baseline IDs; compare tool reports deltas.
3. **Auth** (`modules/auth`). Register or seed users, login, argon2id, JWT access token, rotating refresh token with reuse detection, logout, demo login endpoint limited to the seeded demo society.
   *Acceptance:* tests for expiry, rotation, reuse detection (family revoked), rate limiting, role enforcement.
4. **Tenancy** (`modules/tenancy`, `http/`). Implement `withTenant` and middleware that derives the tenant **only from the verified token**. Residents can read only their own flat's data.
   *Acceptance:* an adversarial suite of at least 40 cases (guessed IDs, cross-tenant joins, role escalation, tampered tokens, missing context) shows **0 cross-tenant reads**. Save as `T1`.
5. **REST API v1.** Societies, flats, meters, usage (granularity and range), unaccounted water summary (stub until Week 3), alerts (stub), profile. Zod validation, consistent errors, pagination with hard caps, OpenAPI at `/api/docs`, **SSE stream** with `Last-Event-ID` resume and per-tenant authorisation.
   *Acceptance:* contract tests pass; `docs/API.md` generated.
6. **Dashboard v1** (`apps/web`). Login with "Try as admin / Try as resident" buttons, role-based routes, admin view (building usage, top consumers, flat table), resident view (today, week, month), live updates via the SSE hook with reconnect, loading skeletons, empty and error states, responsive layout, keyboard-accessible controls. A **"server is waking up" screen** that polls `/api/v1/healthz` with backoff.
   *Acceptance:* Playwright tests for login and both views; axe reports no serious violations on main pages.
7. **Baselines B6 and B7.** Record the k6 baseline (B6) and Lighthouse baseline (B7) on this first working version before optimising. Tag `bench/B6-baseline`, `bench/B7-baseline`.
8. **Redis cache and shared rate limiting** (`platform/cache`, see 6.10). The B6 baseline from task 7 was taken with no cache. For B11, record a dedicated **cache-disabled** run of the rollup-endpoint scenario first (it may reuse the B6 scenario), tag `bench/B11-baseline`, and register it. Then implement the `KeyValueStore` adapter, the read-through cache with version-key invalidation, and Redis-backed rate limiting with an in-memory fallback. Measure hit rate, P50, P95, req/s and Redis commands per request.
   *Acceptance:* B11 final saved and compared with its baseline; two API processes sharing Redis enforce one combined rate limit (integration test); stopping Redis mid-load leaves the error rate at 0 (fail-open test); a rollup recompute increments `cacheVersion` and the next read is fresh; the T1 adversarial suite re-run **with the cache enabled** shows 0 cross-tenant reads.
9. **First deployment (free).** Follow section 10. Production Dockerfile, `render.yaml`, GitHub Actions `deploy.yml` (migrations then deploy hook then smoke test), `keepalive.yml`, Supabase project, HiveMQ Cloud broker, Upstash Redis database, secrets configured by the owner.
   *Acceptance:* the deployed URL serves the SPA, demo login works, readings flow from the simulator through HiveMQ into the dashboard, and the smoke test passes. Record cold-start time (time from first request to healthy response) in `docs/RUNBOOK.md`.

### Week 2 gate
- [ ] Rollup correctness property test passes; B2, B3, B10 final results compared against baselines
- [ ] T1 adversarial suite: 0 cross-tenant reads (also with the cache enabled)
- [ ] Deployed demo works end to end on free tiers
- [ ] B6 and B7 baselines recorded
- [ ] B11 baseline and final saved; fail-open and multi-instance rate-limit tests pass
- [ ] **This is the demo-ready slice.** If the owner needs to show something early, it is here.

---

# WEEK 3: Billing, leak detection, alerts, catch-up behaviour

**Goal:** the business logic that makes this more than a data pipe.

### Tasks
1. **Billing domain** (`modules/billing`, pure functions). Slab computation, shared-cost allocation with the largest remainder method, integer paise only.
   *Acceptance:* property tests (fast-check) prove allocated amounts sum exactly to the total for random inputs; edge cases (zero usage, single flat, slab boundaries, ties in remainders).
2. **Naive billing baseline B4.** Implement `tools/bench/naive/billing-naive`. Run N kill-restart trials, count duplicate and missing bills. Tag `bench/B4-baseline`.
3. **Billing run job.** pg-boss `billing.run` with `singletonKey`, resumable state machine, upserts keyed `(run_id, flat_id)`, progress events over SSE. Admin UI: run, review, publish; resident bill view with line items and period usage chart.
   *Acceptance:* the chaos test kills the worker at random points over N runs: **0 duplicate and 0 missing bills**, identical to an uninterrupted run. Save B4 final. Reconciliation test (T2) shows exact equality.
4. **Mass-balance engine.** Hourly `building_hourly` computation with explicit handling of missing readings (a gap is **not** zero consumption). Admin trend chart.
   *Acceptance:* tests on constructed scenarios, including gaps.
5. **Detectors and evaluation** (`modules/detection`). Implement section 7.6 behind a `Detector` interface. Build the evaluation harness that replays simulator scenarios with injected leaks and compares alerts against ground-truth labels. First record **B5 baselines** (monthly-bill comparison, fixed threshold), tag `bench/B5-baseline`, then evaluate the streaming detectors.
   *Acceptance:* precision, recall, false alerts per flat-month and median detection delay saved for baselines and final; vacation flats raise no alerts. **Pause for the owner to review the leak scenarios.**
6. **Alerts** (`modules/alerts`). Dedupe by `dedupe_key`, lifecycle open, acknowledged, resolved, `alert.escalate` delayed job if unacknowledged, in-app notification only (no paid email service), live updates over SSE, admin alert console.
   *Acceptance:* the same leak never creates duplicate alerts; escalation fires on time; resolved alerts can reopen as new events.
7. **Catch-up on wake.** On boot, compute the gap since the last ingested reading (from `checkpoints`) and have the simulator **backfill** it through the normal MQTT and ingest path at a limited rate; run a `rollup.recompute` sweep and a `detect.scan` from their checkpoints. Add a demo-reset job and a database-size guard (alert in logs at 400 MB; stop the simulator at 450 MB).
   *Acceptance:* an integration test sleeps the server (stops it), advances time, restarts, and shows the dashboard has contiguous data with no duplicates.
8. **Re-measure under combined load.** Run ingestion chaos plus billing plus detection together locally; re-run k6. Save `B1` combined and `B6` v2 results.

### Week 3 gate
- [ ] B4: 0 duplicate and 0 missing bills across all trials; T2 exact reconciliation
- [ ] B5 baselines and final results saved; vacation scenario raises no alerts
- [ ] Alert dedupe and escalation tests pass
- [ ] Catch-up on wake test passes

---

# WEEK 4: Explanations, hardening, final benchmarks, documentation, release

**Goal:** add the LLM feature safely, harden, produce final measured results and the resume material.

### Tasks
1. **Explanation service** (`modules/explain`).
   - Build a **facts object** from the database for one flat and period (usage by day, comparison with the previous period, slab breakdown, shared share, detected anomalies). Only these facts reach the LLM.
   - Call Groq with a JSON-schema response format (`{ summary, reasons[], suggestions[], figures_used[] }`; check which models support strict schema mode in the current Groq docs) and re-validate with Zod.
   - **Numeric verifier:** extract every number and date from the output and check it exists in the facts (within a defined rounding rule). On failure regenerate once, then fall back to a deterministic **template explanation** built from the facts (no LLM).
   - Cache by hash of `(flat, period, facts)` in `explanations_cache`. Per-user rate limiting. Timeouts and retry with backoff on rate limits.
   - **B8 baseline first:** record the ungrounded-prompt variant on the 50-case set, tag `bench/B8-baseline`, then the final.
   *Acceptance:* verifier unit tests reject fabricated figures; B8 baseline and final saved; **owner spot-checks 20 cases**.
2. **LLM red team.** At least 30 prompts: cross-flat requests, injection, jailbreak, "show other residents' usage". The facts fetch is tenant-scoped, so these must be impossible. Save the result (0 leaks required).
3. **Frontend polish.** "Explain my bill" experience with the data used shown alongside, period comparison, alert console, consistent components, code splitting, image and bundle optimisation, error boundaries. Re-run Lighthouse (B7 final) and axe.
   *Acceptance:* Lighthouse improvement over the B7 baseline recorded; Playwright suite covers login, usage, billing, alerts, explanation.
4. **Hardening.** Complete the security checklist (6.6). Memory test: run the deployed configuration locally with the 512 MB limit and record RSS under demo load. Record cold-start time. Record Redis commands per request and the projected monthly usage under demo load against the free quota. Dependency audit. Backup and restore notes in the runbook.
5. **Final benchmark run** on a clean commit, tagged `bench/final`. Run all metrics B1 to B11 and T1/T2 with the same scenarios and machine configuration as the baselines. Generate `RESULTS.md` (baseline vs final tables with deltas) with the compare tool.
   *Acceptance:* no hand-entered numbers; compare tool reports comparable fingerprints for every pair.
6. **Documentation.** `README.md` (problem, architecture diagram in Mermaid, free-tier architecture and why, how to run locally, how to reproduce benchmarks, results, limitations, "all data is simulated"), `docs/architecture.md`, `docs/DESIGN_NOTES.md` (one section per module with idempotency keys and trade-offs), `docs/RUNBOOK.md` (deploy, rollback, wake behaviour, incident basics), `docs/SECURITY.md`, ADR index. A static **landing page** (GitHub Pages) with screenshots, the demo video, a button to open the live demo, and an honest note that it may take up to a minute to wake.
7. **Resume bullets.** Generate `RESUME_BULLETS.md` from result files only (section 11). **Pause for the owner's approval.**
8. **Release.** Tag `v1.0.0`; confirm no secrets or caches are committed; confirm CI green on `main`.

### Week 4 gate
- [ ] B8 baseline and final saved; red team shows 0 leaks
- [ ] Final benchmark results for B1 to B11, T1, T2 generated and compared with baselines
- [ ] Security checklist complete; audit clean or documented
- [ ] Deployed demo healthy; cold-start time and RSS recorded
- [ ] README, RUNBOOK, ADRs, landing page complete
- [ ] `RESUME_BULLETS.md` generated and approved

---

## 10. Zero-cost deployment runbook

### 10.1 One-time setup (owner creates accounts; agent writes the config)
1. **Supabase:** create a project. Choose the region closest to the Render region you will use (check which regions each offers). Enable `pg_partman` and `pg_cron`. Create the `app_rw` role. Record the **session pooler** connection string (port 5432). Keep a separate migration connection string for CI.
2. **HiveMQ Cloud:** create the free serverless cluster, create credentials for the server (one client for ingest and one for the simulator), note the TLS host and port 8883.
3. **Upstash:** create a free Redis database in the region closest to Render and Supabase. Copy the `rediss://` URL into Render as `REDIS_URL`. **Do not add a payment method**; adding one upgrades the database to pay-as-you-go.
4. **Render:** create a free web service from the GitHub repo using `render.yaml`. Region: closest to Supabase. Set environment variables (Appendix A). Add a deploy hook URL as a GitHub secret.
5. **Groq:** create an API key and set it in Render.
6. **GitHub:** repository secrets `DATABASE_URL_MIGRATIONS`, `RENDER_DEPLOY_HOOK_URL`, `SMOKE_TEST_URL`. Enable GitHub Pages for the landing page.

### 10.2 Deploy flow
`merge to main → ci.yml passes → deploy.yml: migrate → trigger Render deploy → wait for /readyz → smoke test (login as demo admin, fetch usage, open SSE for 10 s)`.

### 10.3 Deployed configuration
- `ROLES=api,ingest,worker,simulator`, `NODE_OPTIONS=--max-old-space-size=384`, `RAW_RETENTION_DAYS=3`, demo society of about 30 flats, one reading per meter per minute. `REDIS_URL` points to Upstash (`rediss://`), `CACHE_TTL_S` is set, and the Redis command budget guard is active.
- Express serves the built SPA with gzip and long-cache headers on hashed assets.
- Database size guard from Week 3 is active.

### 10.4 Cold start and sleep behaviour
- The server sleeps after about 15 minutes without requests and takes 30 to 60 s to wake. **Do not try to defeat the sleep.** The SPA shows the waking screen; on boot the catch-up logic backfills simulated data.
- `keepalive.yml` runs weekly and calls an endpoint that executes a trivial database query, so Supabase does not pause the project after 7 days of inactivity. (It will also wake the server; that is fine.)

### 10.5 Rollback
Redeploy the previous commit from Render. Migrations are forward-only, so every migration must be backward compatible with the previous app version (add columns before using them; remove them one release later).

---

## 11. Resume bullets (generate from result files only)

**Integrity rules:** every number names its source file and field; label benchmark numbers as "local benchmark"; say "simulated" for meters; leave a placeholder and a note for anything not measured. The owner approves the final text.

Template (fill from `tools/bench/results/`):
1. Engineered an MQTT ingestion pipeline (Node.js, Mosquitto, PostgreSQL) with ack-after-commit, batched idempotent writes and bounded backpressure, sustaining `[N]` msgs/s in local benchmarks (vs `[B]` naive) with `[0]` lost or duplicate readings across `[N]` broker-restart and replay tests on `[N]` simulated meters.
2. Designed time-partitioned storage (pg_partman, pg_cron) with incremental, late-data-safe rollups, cutting dashboard P95 from `[X]` to `[Y]` ms, rollup refresh time from `[A]` to `[B]` s and the 90-day footprint from `[C]` to `[D]` MB (`-[Z]%`).
3. Built crash-safe, idempotent billing on pg-boss (tiered slabs, largest-remainder cost allocation) with `[0]` duplicate or missing bills across `[N]` kill-restart runs (naive: `[D]` duplicates) and reconciliation exact to the paisa.
4. Built streaming leak detection (EWMA/z-score, night-flow and mass-balance rules) that flagged leaks `[X]` hours earlier than a monthly-bill baseline at `[P]%` precision and `[R]%` recall on `[N]` injected leaks, with no alerts on vacation scenarios.
5. Added a Groq-powered bill explanation service with schema-constrained output and numeric verification (`[G]%` of figures grounded vs `[U]%` ungrounded, `[H]%` cache hit rate, `[0]` cross-tenant leaks in a `[N]`-prompt red-team set).
6. Secured a multi-tenant API with rotating JWT refresh tokens and Postgres row-level security (`[0]` cross-tenant reads in `[N]` adversarial tests), and shipped a React dashboard (Lighthouse `[X]`, LCP `[Y]` s) deployed at ₹0 on Render, Supabase, HiveMQ and Upstash with CI/CD and cold-start handling.
7. Added a Redis (Upstash) read-through cache with rollup-aware invalidation and shared rate limiting, lifting local throughput from `[A]` to `[B]` req/s and cutting dashboard P95 from `[X]` to `[Y]` ms at a `[H]%` hit rate, with limits enforced consistently across `[2]` API instances and `[0]` cross-tenant cache reads.

---

## Appendix A: Environment variables (`.env.example` must list all)

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `ROLES` | `api,ingest,worker,simulator` subset |
| `PORT` | HTTP port |
| `DATABASE_URL` | Supabase session-pooler URL for the app (`app_rw`) |
| `DATABASE_URL_MIGRATIONS` | owner-role URL used only by migrations and CI |
| `DB_POOL_MAX`, `PGBOSS_POOL_MAX` | small pool sizes (about 5 and 3) |
| `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD` | broker connection |
| `MQTT_CLIENT_ID_INGEST`, `MQTT_CLIENT_ID_SIM` | stable client IDs for persistent sessions |
| `JWT_SECRET` (or key pair), `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL` | auth |
| `COOKIE_SECURE` | true in production |
| `GROQ_API_KEY`, `GROQ_MODEL` | LLM |
| `METRICS_TOKEN` | protects `/metrics` |
| `REDIS_URL` | optional; `redis://` locally, `rediss://` Upstash URL when deployed; unset means in-memory fallback |
| `CACHE_TTL_S` | default cache entry TTL |
| `REDIS_COMMAND_BUDGET_MONTHLY` | monthly command budget guard, set below the Upstash free quota (for example 400000) |
| `RAW_RETENTION_DAYS` | raw data retention |
| `SIM_METERS`, `SIM_INTERVAL_S`, `SIM_SEED` | simulator settings |
| `DB_SIZE_WARN_MB`, `DB_SIZE_STOP_MB` | size guard |
| `DEMO_MODE` | enables demo login and demo reset |

## Appendix B: Makefile targets
`make up`, `make down`, `make migrate`, `make seed`, `make verify`, `make test`, `make e2e`, `make bench ID=B1`, `make bench-report`, `make bench-verify`, `make build`.

## Appendix C: Pull request template
Summary, linked task number, acceptance criteria checked, tests added, `make verify` output, benchmark result file (if any), docs updated, risks and rollback.

## Appendix D: ADR template
Title, status, context, decision, alternatives considered, consequences. Create one for: pg-boss over BullMQ, partitioning and rollups over TimescaleDB, single-process roles, session pooler choice, Groq model choice, same-origin SPA and API, Redis as an optional fail-open cache (Upstash free tier).

## Appendix E: `docs/QUESTIONS.md` and `PROGRESS.md` formats
- QUESTIONS: date, task, what is blocked, what you tried, what you need from the owner.
- PROGRESS: date, task number, what was done, tests run, result files produced, next step.

## Appendix F: Interview map

| Question | Where to point |
|---|---|
| How do you handle duplicate and out-of-order messages? | Week 1 ingest, `(meter_id, seq, ts)` key, chaos tests |
| Why ack after commit? | Week 1, at-least-once plus idempotent writes |
| How do rollups stay correct with late data? | Week 2 dirty buckets and property tests |
| How do you enforce multi-tenancy? | Week 2 RLS, transaction-local context, adversarial suite |
| How do you make billing safe to retry? | Week 3 pg-boss `singletonKey`, upserts, chaos test |
| How do you know the detector works? | Week 3 ground-truth simulation, precision, recall, delay |
| How do you stop the LLM inventing numbers? | Week 4 facts-only input, schema, numeric verifier, fallback |
| How did you ship it for free, and what are the trade-offs? | Section 2 and 10, sleep and catch-up design |
| How would you scale to 100k meters? | Benchmarks, broker clustering, partition sizing, read replicas, separate worker service |
