# Smart Water Metering Platform — Build Plan v3

**Status:** Implementation-ready first-release plan; senior backend review incorporated  
**Target:** Backend engineering roles; one Indian apartment society; synthetic data  
**Time budget:** 4–6 weeks  
**Cost constraint:** No payment method and ₹0 deployment

## 1. Outcome and boundaries

Build a software layer for apartment buildings that already have compatible unit water meters. A deterministic meter simulator supplies the first release. The backend accepts readings, calculates monthly consumption, reconciles a society's master water bill into auditable flat statements, and explains high bills through Groq.

The portfolio evidence is **measured software performance, billing correctness, AI behavior, and a labeled simulation of billing fairness**. Each resume bullet must state what was engineered, the engineering mechanism, the measured change, and its scope or business consequence. Do not claim real customer savings, conservation, hardware affordability, or production deployment at a real building.

**First release includes:** one 50-flat society, a main meter, flat meters, manager and resident views, batch ingestion, monthly statement preview and publication, bill explanations, tests, benchmarks, and a public demo.

**Deferred:** hardware, MQTT, Redis, pg-boss, partitioning, retention jobs, live streaming, payment collection, tariff-slab billing, and full multi-society administration. Keep a meter-source adapter and `society_id` columns so MQTT and full tenancy can be added later. Use a second society fixture to test access isolation.

## 2. Stack and repository

| Concern | Decision |
|---|---|
| Language and package management | Node.js LTS, strict TypeScript, pnpm workspaces |
| Frontend | React, Vite, React Router, TanStack Query, Tailwind CSS, Recharts |
| API | Express, Zod for boundaries, Helmet, Pino JSON logging |
| Database | Supabase PostgreSQL; `pg` driver; forward-only SQL migrations |
| Authentication | Supabase Auth for sign-in; `jose` verifies asymmetric JWTs in Express; Express enforces manager/resident access |
| AI | Groq API through `groq-sdk`; `openai/gpt-oss-20b` structured output |
| Tests | Vitest, Supertest, fast-check, Playwright; local PostgreSQL in Docker |
| Load tests | Autocannon plus PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` |
| Hosting | Render Free web service for Express; separate Render static site for React |
| CI | GitHub Actions for lint, type-check, tests, build, and deployment smoke checks |

Use this structure:

```text
apps/server/          Express API, billing, readings, Groq integration
apps/web/             React manager and resident views
packages/shared/      Zod schemas and API types
packages/db/          SQL migrations and seed data
tools/simulator/      Seeded reading generator and HTTP publisher
tools/bench/          Baselines, scenarios, raw results, report generator
docs/                 Architecture, API, runbook, decisions
```

Keep the server a modular monolith. React obtains application data only through Express; Supabase Auth is used only for sign-in. Disable Supabase's generated Data API for application tables and place those tables in a non-exposed `app` schema. Use a least-privilege `app_rw` database role at runtime and a separate migration credential; never use the `postgres` owner or Supabase service-role key for ordinary API queries. The Groq key and database password exist only in server environment variables. Use the Supabase **session pooler** connection string with a small `pg` pool for the persistent Render server. Record exact dependency versions when bootstrapping. Follow Supabase's [Data API security](https://supabase.com/docs/guides/api/securing-your-api) and [connection](https://supabase.com/docs/guides/database/connecting-to-postgres) guidance.

Log a request ID, route, status, and duration with Pino. Provide shallow `/healthz` and database-checking `/readyz` endpoints. Set timeouts on database and Groq calls; return a clear degraded state when an upstream service is unavailable. These signals support debugging and benchmark interpretation without adding a monitoring service.

## 3. Data and API contracts

### Data model

- `societies`, `flats`, `profiles` (Supabase Auth user ID, society, role, optional flat).
- `meters` (society, optional flat, kind `main` or `flat`).
- `readings` (meter, stable source reading ID, measured timestamp, cumulative millilitres, received timestamp, source). Unique `(meter_id, source_reading_id)`; index `(meter_id, measured_at)`.
- `master_bills` (society, period, invoice volume, variable paise, fixed paise, total paise, status).
- `billing_revisions`, `statements`, `statement_lines`, and `audit_events`.
- `explanation_cache` (statement revision, model/prompt version, validated result, token counts).

Store money as integer paise and volume as integer millilitres (`bigint`). JSON APIs encode those values as decimal strings because JavaScript JSON cannot safely represent arbitrary `bigint`. Store timestamps as UTC `timestamptz`; use `Asia/Kolkata` to define the society's calendar-month boundaries. Database constraints enforce nonnegative volumes and charges, meter ownership, one main meter per society, and one active flat meter per flat. Migration tests verify these constraints against real PostgreSQL.

### Meter ingestion

The simulator generates 30 days of hourly cumulative readings for 50 flats and one main meter using a fixed seed. It also generates labeled duplicates, late delivery, gaps, counter resets, high usage, and common-area usage. The same seed and scenario version must produce the same dataset.

`POST /api/v1/readings/batches` accepts at most 500 readings through a server-held ingestion credential. An adapter maps each source to `{ meterId, sourceReadingId, measuredAt, cumulativeMl }`. Reject a malformed request with HTTP 400; for a structurally valid batch, process items in one transaction and return accepted, duplicate, and rejected counts with item-level reasons. The same ID and identical payload is a duplicate; the same ID with different timestamp or volume is a **conflict**, recorded for review rather than silently overwritten. Commit before returning success. A timeout or process restart may cause the sender to retry the full batch safely.

Accept out-of-order delivery, then calculate consumption by measurement time. Detect a decreasing counter or a missing boundary reading and mark the period **needs review**. Do not silently treat an uncertain interval as zero. The simulator supplies exact month-start and month-end readings; the first release does not estimate missing boundaries.

### Billing

Manager endpoints: `POST /api/v1/billing-periods` (create draft), `PUT /api/v1/billing-periods/:id` (edit current draft), `POST /api/v1/billing-periods/:id/preview`, `POST /api/v1/billing-periods/:id/publish`, and `POST /api/v1/billing-periods/:id/revisions` (create a new draft from the latest published revision). Resident endpoints: `GET /api/v1/me/statements` and `GET /api/v1/me/statements/:id`. Publish and revision requests require an `Idempotency-Key`; persist the key and request hash so an identical retry returns the original result and a reused key with different input returns a conflict. Derive society and flat access from the verified user profile, never from a trusted client-supplied ID.

The manager enters invoice volume, variable charge, fixed charge, and total charge. Require `variable + fixed = total` and the invoice volume to match the main-meter period delta for this synthetic release. The master bill is the source of monetary truth.

For each flat, use exact boundary readings to obtain period volume. Let `common volume = main volume − sum(flat volumes)`. Block publication if any required reading is missing, any period crosses an unresolved reset, common volume is negative, or variable charge is positive while main volume is zero.

Allocate variable charge proportionally across each flat's volume **and one common-volume bucket** using integer arithmetic and largest-remainder rounding. Divide the common bucket and fixed charge equally among flats, again using largest-remainder rounding with flat ID as the tie-breaker. Every statement lists flat usage, shared common usage charge, fixed charge, and total. The sum of statement totals must equal the master bill **exactly to the paisa**.

Preview is read-only and returns a hash of the canonical readings, bill version, allocation rule, and calculated statements. Publication requires that preview hash, locks the billing-period row, and recomputes within one consistent PostgreSQL transaction snapshot; if inputs changed since preview, return a conflict and require a new preview. Record the input reading cutoff, master-bill version, immutable statement snapshots, and audit event together. A concurrent publish can produce only one revision. Late readings or a corrected master bill require a new draft revision and an explicit republish; never edit a published statement in place. `GET /api/v1/me/statements/:id` returns the latest published revision by default and exposes prior revisions for audit.

### Groq explanation

`POST /api/v1/statements/:id/explanation` builds a minimal facts object from that resident's statement, prior period, usage, and line items. Groq chooses structured reason codes and fact references, with a short number-free summary. Use Groq's [strict JSON-schema mode](https://console.groq.com/docs/structured-outputs) for the selected model (all schema fields required; `additionalProperties: false`), then validate again with Zod. The backend rejects unsupported fact IDs and numeric text and renders all displayed figures from database facts. Cache by statement revision, model, prompt version, and facts hash. A different statement revision cannot reuse an old explanation.

On timeout, `429`, invalid output, or missing key in local development, return a deterministic explanation from the same facts and mark it as a fallback in logs and evaluation. Cap retries and respect `Retry-After`; never hold a database transaction open during a model call. Groq cannot calculate charges or access another resident's statement. Public demo traffic serves cached explanations and cannot trigger unlimited model calls.

## 4. Demo and security

The public React site loads a clearly labeled synthetic, read-only manager and resident snapshot immediately. When the API is available, it can show a live **non-mutating** bill preview. If Render is waking or Supabase is paused, the static snapshot remains usable and is labeled as such. Full write actions require a manager login.

Configure Supabase Auth with an asymmetric signing key. Express verifies each access token's signature through the project JWKS and checks issuer, audience, and expiry; it then looks up the user's active profile and obtains society, role, and flat from the database. Follow Supabase's [JWT verification guidance](https://supabase.com/docs/guides/auth/jwts). Never treat a client-supplied society ID or the JWT's generic `role` claim as application authorization. Check every resource's society ownership and prevent residents from reading other flats. Test isolation using two society fixtures and test that application tables are inaccessible through Supabase's Data API. Restrict CORS to the deployed frontend, limit request bodies, throttle Groq endpoints, use parameterized SQL, and never log secrets or raw credentials. Keep all demo records synthetic.

The simulator runs as a local or one-time seed tool, **not** as a perpetual process on Render. No background task is required for the first release.

## 5. Evidence and acceptance tests

Build the benchmark harness before optimization. Save scenario name and hash, seed, dataset size, Git commit, CPU/RAM/OS, Node and PostgreSQL versions, raw run results, and the command used. Run one warm-up and at least five measured repetitions. Report each run's throughput and per-request p50/p95, then the median and spread **across runs**; do not calculate a p95 from five run summaries. Compare only runs with matching payloads, scenario, concurrency, and machine configuration. Report a non-improvement honestly.

| Claim candidate | Baseline | Final measurement |
|---|---|---|
| Ingestion efficiency | One INSERT per reading inside the same batch API | Batched idempotent inserts: sustained readings/s and request p50/p95 under identical HTTP payloads and concurrency |
| Billing query efficiency | First correct query with the base meter/time index | Optimized query and justified additional index: request p50/p95 and saved query plans on the same data |
| Billing fairness in simulation | Equal split of the same master bill | Number of flats overcharged and total amount misallocated under equal split |
| Reliability | Retries, concurrent publication, and interrupted requests | Duplicate readings/statements and exact reconciliation; report trial counts, not an invented percentage improvement |
| AI quality and efficiency | Deterministic template and uncached Groq calls | Primary-reason accuracy on a frozen labeled set, fallback rate, calls/tokens avoided by caching, and model latency |

For the fairness comparison, equal-split the **same total master bill** across flats with the same rounding tie-breaker. Define simulated misallocated amount as `sum(abs(equal_split_paise − metered_paise)) / 2`; count a flat as overcharged only when its equal-split amount exceeds its metered statement. Label this **simulated allocation difference**, not money saved. Use a separate local benchmark database for large workloads; do not use Render cold starts or Supabase network latency as evidence of a query optimization.

Freeze at least 30 labeled bill scenarios before tuning prompts. Include high flat usage, high common-area share, fixed-charge dominance, prior-period change, and no clear primary cause. Compare Groq's selected primary reason with both the known scenario label and the deterministic template. Record counts as well as percentages, inspect failures, and report the chosen model and prompt version. Backend-rendered figures are a **correctness design**, not proof that the model itself never hallucinates. Count rejected model outputs and fallbacks separately. For cost efficiency, report actual Groq calls/tokens avoided by caching; quote currency savings only if calculated from a dated provider price and explicitly labeled as a list-price estimate.

### Resume-bullet contract

The owner's target style is **action + engineered mechanism + measured before/after + business or user consequence + measurement scope**. Aim for three strong bullets, not a list of every library. Every numeric claim must name a result file and field in `tools/bench/results/`; generate `RESULTS.md` and `RESUME_BULLETS.md` from those files rather than hand-entering metrics. If a result has no defensible baseline, state an absolute outcome with its test count. Do not turn a synthetic allocation difference into real revenue, savings, or conservation.

Use these templates only after measurements exist:

1. **Ingestion:** “Engineered an idempotent meter-reading API with PostgreSQL uniqueness and batched writes, increasing local throughput from `[baseline]` to `[final]` readings/s at `[concurrency]` while storing zero duplicates across `[N]` replayed synthetic readings for reliable monthly billing.”
2. **Billing:** “Built a transactional master-bill allocation engine using integer-paisa arithmetic and immutable revisions, reconciling `[N]` simulated monthly statements exactly and exposing ₹`[amount]` in simulated allocation difference versus equal splitting across `[N]` flats.”
3. **AI:** “Integrated Groq-based bill explanations with schema validation, fact references, and a deterministic fallback, achieving `[correct]/[total]` primary-reason matches on frozen synthetic cases and reducing repeated-request model calls by `[X]%` through revision-aware caching so residents can inspect evidence behind their charges.”

Replace, omit, or combine bullets based on measured results; do not fill a placeholder with an estimate. In the README and interview notes, separate **local benchmark**, **synthetic business scenario**, and **hosted demo** results.

Required tests cover identical and conflicting reading IDs, out-of-order readings, gaps, resets, month boundaries, zero usage, rounding ties, master-volume mismatch, negative common volume, changed inputs after preview, repeated and concurrent publish, revision immutability, cross-flat and cross-society access, Groq rate limits, malformed output, stale explanation caches, and API/database failure. Use property tests for allocation sum and retry invariance. Run one Playwright path for each role. CI runs lint, type-check, unit and integration tests, and builds both apps. Load tests run locally, outside CI.

## 6. Build sequence and gates

### Stage 1 — Foundation and simulator (week 1)

Keep v2 as historical context, bootstrap the pnpm workspace, local PostgreSQL, migrations, seed tool, CI, and benchmark harness. Create the private `app` schema, limited runtime role, and migration role. Generate the fixed 50-flat scenario and record its seed and labels.

**Gate:** a clean install works; migrations and seed are repeatable; simulator output is deterministic; database grants block application access outside its schema; `pnpm verify` is green.

### Stage 2 — Reliable ingestion (week 2)

Record the single-INSERT baseline, implement the batch API, uniqueness constraint, validation, and replay tests, then record the optimized result.

**Gate:** 10,000 replayed readings create no duplicates; a reused ID with changed content is reported as a conflict; accepted readings survive a server restart; every rejected reading has a reason; baseline and final results are reproducible.

### Stage 3 — Billing and minimal UI (weeks 3–4)

Implement allocation as pure functions, preview, transactional publication, revisions, and manager/resident views. Record the query baseline before adding its optimization.

**Gate:** all published statements reconcile exactly; invalid periods cannot publish; retries and concurrent requests do not duplicate statements; prior revisions remain readable; both roles complete their Playwright flows.

### Stage 4 — Explanation, release, and evidence (weeks 5–6)

Implement Groq structured output and fallback, evaluate labeled bill cases, run final benchmarks, deploy, write the README/runbook, and generate result-backed resume bullets.

**Gate:** at least 30 frozen labeled explanation cases are evaluated against the template baseline; no displayed figure comes from model text; Data API access to application tables is blocked; deployed demo works at ₹0; results include reproducibility metadata and every resume claim links to evidence.

## 7. Free-tier deployment notes

Use Render Free for Express and a separate static React site, Supabase Free for PostgreSQL and Auth, and Groq Free for explanations. Configure environment variables in the services, never in Git. Set up Supabase asymmetric Auth signing, disable its Data API for application tables, and test the session-pooler connection from Render before relying on deployment. Keep the hosted seed small; run scale benchmarks locally. Check current provider quotas at deployment and do not add payment methods.

Render Free sleeps after inactivity, so measure cold-start time separately from warm API latency. Supabase Free may pause after low activity; the static demo snapshot remains available, and the runbook explains manual resume. Groq rate limits vary by account; cache explanations and handle `429` without changing billing. See [Render Free](https://render.com/docs/free), [Supabase Free pricing](https://supabase.com/pricing), [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), and [Groq rate limits](https://console.groq.com/docs/rate-limits).

After v1 is complete and measured, add MQTT behind the meter adapter if it strengthens the portfolio story. Select a currently available broker then; the HiveMQ Cloud Serverless option in v2 can no longer be created and retires on December 31, 2026. See [HiveMQ's notice](https://docs.hivemq.com/hivemq-cloud/serverless-end-of-life.html).
