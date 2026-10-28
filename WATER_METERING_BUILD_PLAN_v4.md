# Smart Water Metering Platform — Build Plan v4

**Status:** Stage 3 duplicate-period repair passed its local gate; Stage 4 remains next; Stage 2 benchmark evidence preserved  
**Target:** Backend-focused PERN portfolio project; real historical event ingestion plus a separate illustrative apartment billing workflow  
**Time budget:** Application-ready core first, then 4–6 weeks for the complete release  
**Cost constraint:** No payment method and ₹0 deployment

## 1. Outcome and boundaries

Build a software layer for apartment buildings that already have compatible unit water meters. The first release imports and replays published, anonymized HSB water-consumption events for historical analytics. A **separate fictional building fixture** exercises illustrative invoice allocation, auditable resident statements, and Groq explanations. The HSB archive cannot certify a complete billing period, so its event sums must never appear as the inputs to those statements. This is a portfolio case study of a proposed product, not a deployment at the source building.

The portfolio evidence is **measured ingestion performance on real historical rows, correctness and security of the fictional-fixture billing workflow, AI behavior, and operational diagnostics**. Each resume bullet must state what was engineered, the mechanism, measured result or baseline comparison, and operational or user consequence. Do not claim actual customer savings, reduced water use, a real-data fairness result, hardware affordability, or a production deployment at the source building.

**First release includes:** HSB source-event ingestion and historical analytics for its 28 apartment pseudonyms; a clearly separated fictional apartment-building billing demo; batch API, manager/resident views, billing preview/publication, Groq explanations, tests, benchmarks, CI, observable API behavior, and a public demo. Future compatible interval or cumulative feeds and physical main-meter support remain separate source adapters; the HSB archive supplies neither a certified billing series nor a matching invoice.

**Deferred:** hardware, MQTT, Redis, pg-boss, partitioning, retention jobs, live streaming, payment collection, tariff-slab billing, autonomous agents, and full multi-society administration. Keep a meter-source adapter and `society_id` columns so new sources and tenancy can be added later. Use a second fictional society fixture only for access-isolation tests; never mix its data into research-data claims.

### Published data and provenance

Use [HSB Living Lab Fixture-Level Household Water Consumption Dataset, version 1.1.0](https://zenodo.org/records/22076411) as the primary historical source. Its record reports 652,315 cleaned measurements from 214 pulse-counting water meters across 28 apartments and 9 residential clusters in Gothenburg, Sweden, at 1 L resolution and nominal 10-minute reporting times from December 2019 to January 2023; overall temporal coverage is 83.9%. The package includes a data dictionary and cleaning/anonymization scripts. Stage 1 verified CC BY 4.0 and the archive checksum; see [the source audit](docs/data/HSB_AUDIT.md). Cite the record, article, version, and licence in the repository and preserve the archive checksum in import manifests.

The [Stage 1 audit](docs/data/HSB_AUDIT.md) found positive timestamped **events**, not proven closed intervals. Zero-use rows were removed and there is no per-meter heartbeat/status mask; repeated sensor/timestamp keys also exist. Therefore **zero apartments and zero common periods qualify for coverage-certified measured billing** from this file. Its dictionary calls `value` litres, while aggregate and cleaning evidence support m³; the importer records that inference and Q-05 remains open. Source event sums may be shown only as analytics with the unit and coverage caveats. Billing uses [decision 001's](docs/decisions/001-hsb-events-and-billing-fallback.md) separately labeled fictional fixture.

Use the terms **observed source event**, **derived apartment event sum**, **replayed historical import**, **fictional billing fixture**, **injected fault test**, and **illustrative invoice** consistently in the database, UI, reports, and resume evidence. A local HTTP replay of historical data is not live telemetry.

## 2. Stack and repository

| Concern | Decision |
|---|---|
| Language and package management | Node.js LTS, strict TypeScript, npm workspaces |
| Frontend | React, Vite, React Router, TanStack Query, Tailwind CSS, Recharts |
| API | Express, Zod for boundaries, Helmet, Pino JSON logging |
| Database | Supabase PostgreSQL; `pg` driver; forward-only SQL migrations |
| Authentication | Supabase Auth for sign-in; `jose` verifies asymmetric JWTs in Express; Express enforces manager/resident access |
| AI | Groq API through `groq-sdk`; `openai/gpt-oss-20b` structured output |
| Tests | Vitest, Supertest, fast-check, Playwright; local PostgreSQL in Docker |
| Load tests | Autocannon plus PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` |
| Hosting | Render Free web service for Express; separate Render static site for React |
| CI/CD | GitHub Actions for lint, type-check, tests, build, dependency/security checks, and deployment smoke checks |
| Operations | Pino structured logs, request IDs, health/readiness checks, bounded fault drills, and a troubleshooting runbook |

Use this structure:

```text
apps/server/          Express API, billing, readings, Groq integration
apps/web/             React manager and resident views
packages/shared/      Zod schemas and API types
packages/db/          SQL migrations and seed data
tools/import-hsb/     Dataset audit, checksums, deterministic adapter, replay CLI
tools/fault-fixtures/ Labeled duplicates, gaps, resets, and adversarial API cases
tools/bench/          Baselines, scenarios, raw results, report generator
docs/                 Architecture, API, runbook, decisions
```

Keep the server a modular monolith. React obtains application data only through Express; Supabase Auth is used only for sign-in. Disable Supabase's generated Data API for application tables and place those tables in a non-exposed `app` schema. Use a least-privilege `app_rw` database role at runtime and a separate migration credential; never use the `postgres` owner or Supabase service-role key for ordinary API queries. The Groq key and database password exist only in server environment variables. Use the Supabase **session pooler** connection string with a small `pg` pool for the persistent Render server. Record exact dependency versions when bootstrapping. Follow Supabase's [Data API security](https://supabase.com/docs/guides/api/securing-your-api) and [connection](https://supabase.com/docs/guides/database/connecting-to-postgres) guidance.

Log a request ID, route, status, duration, source batch ID, and billing revision ID with Pino, without logging resident usage or secrets. Provide shallow `/healthz` and database-checking `/readyz` endpoints. Set timeouts on database and Groq calls; return a clear degraded state when an upstream service is unavailable. Add a local fault drill for database unavailability, Groq timeout, duplicate replay, and stale billing preview; document symptom, log/metric signal, root cause, and recovery in the runbook. This produces concrete evidence for the job description's observability and troubleshooting requirements without a paid monitoring service.

### Job-description alignment and priority

The attached IT Software Engineer/Intern description emphasizes secure, maintainable TypeScript services; AI/LLM APIs; testing and code review of AI-assisted work; CI/CD; deployment; observability; and incident debugging. Build in this order:

| Priority | Project evidence | What it demonstrates |
|---|---|---|
| P0, application-ready | Real-data adapter, idempotent ingestion, SQL constraints, auth/authorization, billing correctness, API tests, GitHub Actions, deployed read-only demo, README architecture diagram | Requirements translated into a secure, testable service across the full delivery lifecycle |
| P1, strong differentiator | Baseline-versus-optimized ingestion and query benchmarks; Groq structured explanations with deterministic fallback and frozen evaluation; request tracing and a fault drill | Performance, reliable AI integration, operational support, and evidence-backed improvements |
| P2, after application | Optional local OpenTelemetry collector/traces or bounded read-only tool workflow, only if P0/P1 are complete | Additional platform/agentic experience without displacing the core deliverable |

Keep a one-page `docs/requirements.md`: user roles, billing invariants, data limitations, acceptance criteria, and a short decision log. Record AI-assisted coding use in `docs/engineering-workflow.md`: task, generated suggestion, human changes, tests, security review, and rejected output. Do not claim an agentic workflow or enterprise SaaS integration unless one is actually built and evaluated. Provide a Dockerfile and local Docker Compose for PostgreSQL; Render remains the deployment target. No AWS/GCP/Azure, Kubernetes, Salesforce, SAP, or ServiceNow integration is required for this portfolio project.

## 3. Data and API contracts

### Data model

- `societies`, `flats`, `profiles` (Supabase Auth user ID, society, role, optional flat).
- `source_manifests` (dataset DOI/version, archive checksum, licence, adapter version, import counts, audit result).
- `meters` (society, optional flat, source meter ID, fixture/channel, kind `fixture`, `flat`, `shared`, or `main`). A source fixture maps to a flat only when the dictionary proves that mapping.
- `source_events` (source manifest, archive-scoped CSV row key, source sensor ID, apartment pseudonym if present, event time, inferred millilitres, parsed-row hash, provenance). Unique `(source_manifest_id, source_row_key)`; index `(source_sensor_id, event_at)`. A separate ingestion-conflict table records reused keys with changed content. A future `interval_readings` table is reserved for feeds that truly supply interval boundaries.
- `billing_periods` and `master_bills` (society, `[start,end)`, currency, invoice volume if known, variable/fixed/total amount in minor units, `observed_invoice` or `illustrative_invoice` provenance, status).
- `billing_revisions`, `statements`, `statement_lines`, and `audit_events`.
- `explanation_cache` (statement revision, model/prompt version, validated result, token counts).

Store money as integer minor units (`bigint`, paise for INR) and volume as integer millilitres (`bigint`). JSON APIs encode those values as decimal strings because JavaScript JSON cannot safely represent arbitrary `bigint`. Store event times as UTC `timestamptz`; interpret source analytics in `Europe/Stockholm` and fictional billing boundaries in the configured society time zone. Constraints enforce nonnegative volumes and charges, source provenance, and meter ownership. Repeated HSB sensor/timestamp keys are legitimate distinct CSV rows; uniqueness is by manifest plus source row key. Migration tests verify these against real PostgreSQL.

### Meter ingestion

The HSB importer is the primary data path. It checks the archive and CSV checksums, records dataset version and attribution, validates timestamps and source sensor mappings, and converts source `value` using the explicitly documented m³ inference. It stores archive-scoped physical CSV line keys and an import manifest. For any derived apartment event sum, retain source sensor IDs and the exact event-time range so a reviewer can trace it back to observed rows. Do not relabel events as closed intervals or cumulative meter readings. A hash of parsed CSV fields is **not** a raw-byte row hash; name and document the hash according to what was actually hashed.

`POST /api/v1/source-events/batches` accepts at most 500 HSB event records through a server-held ingestion credential. Its source adapter produces `{ sourceManifestId, sourceRowKey, sourceSensorId, eventAt, volumeMl, channel, parsedRowHash }` after verified mapping and the documented unit inference. The server derives provenance and verifies manifest/source authorization; the client cannot assert an arbitrary observed provenance. Reject a malformed request with HTTP 400; for a structurally valid batch, process items in one transaction and return accepted, duplicate, conflict, and rejected counts with item-level reason codes. The same key and identical canonical payload is a duplicate; the same key with changed content is a **conflict**, recorded for review rather than overwritten. Commit before returning success so a sender can safely retry after timeout or restart. Permit out-of-order delivery and keep import order distinct from event time.

The HSB archive has no coverage-certified billable totals. Never silently count an absent source event as zero. Preserve repeated sensor/timestamp source rows, detect identical replay by archive-scoped row identity, and reject impossible payloads. Keep injected duplicate, late-delivery, high-use, and failure cases in labeled test fixtures; counter-reset and interval-gap tests belong to a future cumulative/interval feed, not to HSB event semantics. The HSB source itself is never modified to create a stronger real-data claim.

### Billing

Manager endpoints: `POST /api/v1/billing-periods` (create draft), `PUT /api/v1/billing-periods/:id` (edit current draft), `POST /api/v1/billing-periods/:id/preview`, `POST /api/v1/billing-periods/:id/publish`, and `POST /api/v1/billing-periods/:id/revisions` (create a new draft from the latest published revision). Resident endpoints: `GET /api/v1/me/statements` and `GET /api/v1/me/statements/:id`. Publish and revision requests require an `Idempotency-Key`; persist the key and request hash so an identical retry returns the original result and a reused key with different input returns a conflict. Derive society and flat access from the verified user profile, never from a trusted client-supplied ID.

The manager enters invoice volume (if supplied), variable charge, fixed charge, and total charge. Require `variable + fixed = total`. The public billing walkthrough uses the **separate fictional fixture** at `tools/fault-fixtures/billing-demo.json` and an explicitly illustrative INR invoice generated from documented assumptions. Mark fixture and invoice provenance in every API response and screen. The HSB dataset supplies no coverage-certified billing period, matching utility invoice, or physical main-meter series. A future real-invoice mode may use a manager-entered invoice as monetary truth; if physical main readings exist, validate the invoice volume against them and block a mismatch.

For the fictional billing fixture, calculate each flat's period volume from its declared complete input and reject missing or conflicting boundaries. Never join HSB source events into this computation. For a future certified feed with a real main meter, `common volume = main volume − sum(flat volumes)`; block negative or unresolved common volume. The illustrative fixture's shared bucket, if any, must be explicitly labeled as fixture data. Block publication if inputs are incomplete, mappings are ambiguous, charge totals disagree, or positive variable charge has zero allocatable volume.

Allocate variable charge proportionally across the fixture's flat volumes and any explicitly modeled shared bucket using integer arithmetic and largest-remainder rounding. Divide the shared bucket and fixed charge equally among flats, again using largest-remainder rounding with flat ID as the tie-breaker. Every statement lists fictional-fixture provenance, flat volume, any shared charge, fixed charge, total, and illustrative-invoice provenance. The sum of statement totals must equal the illustrative invoice **exactly to the minor unit** (to the paisa for INR).

Preview is read-only and returns a hash of the canonical readings, bill version, allocation rule, and calculated statements. Publication requires that preview hash, locks the billing-period row, and recomputes within one consistent PostgreSQL transaction snapshot; if inputs changed since preview, return a conflict and require a new preview. Record the input reading cutoff, master-bill version, immutable statement snapshots, and audit event together. A concurrent publish can produce only one revision. Late readings or a corrected master bill require a new draft revision and an explicit republish; never edit a published statement in place. `GET /api/v1/me/statements/:id` returns the latest published revision by default and exposes prior revisions for audit.

### Groq explanation

`POST /api/v1/statements/:id/explanation` builds a minimal facts object from that resident's statement, prior period, usage, and line items. Groq chooses structured reason codes and fact references, with a short number-free summary. Use Groq's [strict JSON-schema mode](https://console.groq.com/docs/structured-outputs) for the selected model (all schema fields required; `additionalProperties: false`), then validate again with Zod. The backend rejects unsupported fact IDs and numeric text and renders all displayed figures from database facts. Cache by statement revision, model, prompt version, and facts hash. A different statement revision cannot reuse an old explanation.

On timeout, `429`, invalid output, or missing key in local development, return a deterministic explanation from the same facts and mark it as a fallback in logs and evaluation. Cap retries and respect `Retry-After`; never hold a database transaction open during a model call. Groq cannot calculate charges or access another resident's statement. Public demo traffic serves cached explanations and cannot trigger unlimited model calls.

## 4. Demo and security

The public React site shows historical HSB event analytics and a **separate** clearly labeled fictional-fixture billing walkthrough. Never combine them into one apparent bill. Show dataset citation, source country and years, import date, unit inference, and lack of certified coverage beside source charts; show fictional-fixture and illustrative-invoice provenance beside statements. When the API is available, it can show a live **non-mutating** bill preview. If Render is waking or Supabase is paused, the static snapshot remains usable and is labeled as a cached snapshot. Full write actions require a manager login.

Configure Supabase Auth with an asymmetric signing key. Express verifies each access token's signature through the project JWKS and checks issuer, audience, and expiry; it then looks up the user's active profile and obtains society, role, and flat from the database. Follow Supabase's [JWT verification guidance](https://supabase.com/docs/guides/auth/jwts). Never treat a client-supplied society ID or the JWT's generic `role` claim as application authorization. Check every resource's society ownership and prevent residents from reading other flats. Test isolation using two society fixtures and test that application tables are inaccessible through Supabase's Data API. Restrict CORS to the deployed frontend, limit request bodies, throttle Groq endpoints, use parameterized SQL, and never log secrets or raw credentials. Source apartment IDs remain pseudonyms; demo login accounts are fictional and cannot change source measurements.

The importer/replay tool runs locally or as a controlled one-time seed, **not** as a perpetual process on Render. Host a small verified subset on Supabase Free; use the full published archive locally for benchmarks. No background task is required for the first release.

## 5. Evidence and acceptance tests

Build the benchmark harness before optimization. Save source DOI/version and archive checksum or test-fixture seed, scenario name and hash, imported row count, eligible apartment/period count, Git commit, CPU/RAM/OS, Node and PostgreSQL versions, raw run results, and the command used. Run one warm-up and at least five measured repetitions. Report each run's throughput and per-request p50/p95, then the median and spread **across runs**; do not calculate a p95 from five run summaries. Compare only runs with matching payloads, source version, concurrency, and machine configuration. Report a non-improvement honestly.

| Claim candidate | Baseline | Final measurement |
|---|---|---|
| Ingestion efficiency | One INSERT per HSB source event inside the same HTTP batch API | Batched idempotent inserts: sustained records/s and request p50/p95 on identical published rows, payloads, concurrency and clean database state |
| Billing query efficiency | First correct query on the fictional billing fixture | Optimized query and justified additional index: request p50/p95 and saved query plans on identical fixture data |
| Counterfactual allocation | Equal split of one illustrative invoice | Number of fictional flats that would pay more under equal split and total modeled redistribution, with explicit fixture and invoice assumptions |
| Reliability/security | Retries, concurrent publication, interrupted requests, cross-flat reads, and source conflicts | Duplicate source events/statements, exact reconciliation, authorization outcomes, and trial counts; no invented improvement percentage |
| AI quality and efficiency | Deterministic template and uncached Groq calls | Primary-reason agreement on a frozen labeled set, rejected-output/fallback counts, calls/tokens avoided by caching, and model latency |
| Operational response | Injected database/Groq failures | Time to identify the failing dependency from request ID, structured logs, and health/readiness state, measured during a scripted local fault drill |

For the allocation comparison, equal-split the **same illustrative invoice** across the same fictional flats with the same rounding tie-breaker. Define modeled redistribution as `sum(abs(equal_split_minor − usage_based_minor)) / 2`; count a flat only if its equal-split amount exceeds its usage-based statement. Label this **fictional-fixture counterfactual allocation difference**, not money saved, actual overbilling, or a finding from HSB measurements. Use a separate local benchmark database for large workloads; do not use Render cold starts or Supabase network latency as evidence of a query optimization.

Freeze at least 30 labeled fictional-fixture statement cases before tuning prompts, including high flat usage, high shared usage, fixed-charge dominance, prior-period change, and no clear primary cause. Label primary reasons from deterministic bill facts, not from Groq's answer. Compare Groq's selected primary reason with both the frozen label and the deterministic template. Record counts as well as percentages, inspect failures, and report model/prompt versions. Backend-rendered figures are a **correctness design**, not proof that the model itself never hallucinates. Count rejected model outputs and fallbacks separately. For cost efficiency, report actual Groq calls/tokens avoided by caching; quote currency savings only if calculated from a dated provider price and labeled as a list-price estimate.

### Resume-bullet contract

The owner's target style is **action + engineered mechanism + measured before/after + business or user consequence + measurement scope**. For this job description, aim for three bullets covering a secure/reliable backend, AI integration, and delivery/operations. Every numeric claim must name a result file and field in `tools/bench/results/` or an auditable test/evaluation report; generate `RESULTS.md` and `RESUME_BULLETS.md` from those files rather than hand-entering metrics. If a result has no defensible baseline, state an absolute outcome with its test count. Use “real historical water measurements” only for the source-event ingestion/analytics path, with unit caveats where relevant; call billing inputs fictional, the invoice illustrative, and the allocation difference counterfactual. Do not turn that difference into real revenue, savings, conservation, or customer impact.

Use these templates only after measurements exist:

1. **Backend/data:** “Engineered an idempotent TypeScript/Express ingestion API with PostgreSQL uniqueness and batched writes for `[N]` published water-measurement records, raising local throughput from `[baseline]` to `[final]` records/s at `[concurrency]` while producing zero duplicate inserts across `[replay count]` retries.”
2. **Billing/security:** “Built a role-scoped, transactional billing engine with integer-minor-unit allocation and immutable revisions, reconciling `[N]` fictional-fixture statements exactly and rejecting `[X]/[X]` tested cross-apartment access attempts; `[Y]` fictional flats would pay more under equal splitting of the same illustrative invoice.”
3. **AI:** “Integrated Groq bill explanations with structured outputs, fact references, and deterministic fallback, matching `[correct]/[total]` frozen primary-reason labels and cutting repeat-request model calls by `[X]%` through revision-aware caching so residents can inspect their charges.”
4. **Optional delivery/operations:** “Built a Docker-backed local environment and GitHub Actions pipeline covering `[N]` automated checks, then instrumented request IDs, health probes, and structured logs to identify `[N]/[N]` injected API failures during a documented fault drill.”

If one bullet becomes overloaded, split AI and operations and omit the weakest claim. Replace, omit, or combine bullets based on measured results; do not fill a placeholder with an estimate. In the README and interview notes, separate **published source facts**, **local benchmarks**, **counterfactual invoice analysis**, **injected test cases**, and **hosted demo** results. Do not imply that the research building used this software.

Required tests cover identical and conflicting source row keys, out-of-order event arrival, repeated sensor/timestamp events, invalid fixture mappings, unit conversion assumption, fictional-fixture gaps/zero usage, billing time-zone boundaries, rounding ties, invoice/main-volume mismatch when a main meter exists, negative common volume, changed inputs after preview, repeated/concurrent publish, revision immutability, cross-flat and cross-society access, Groq rate limits, malformed output, stale explanation caches, and API/database failure. Use property tests for allocation sum and retry invariance. Run one Playwright path for each role. CI runs lint, type-check, unit and PostgreSQL integration tests, dependency/security checks, and builds both apps; deployment smoke checks verify `/healthz`, `/readyz`, and a read-only statement. Load tests run locally, outside CI. Review AI-assisted code for SQL authorization, secrets, external calls, and failure paths before merging.

## 6. Build sequence and gates

### Application-ready cut — do this first

Before polishing charts or adding optional infrastructure, complete a narrow vertical slice: source-data audit and citation; one deterministic import and retry; one authenticated manager preview/publish flow; one resident-only statement; one Groq explanation with fallback; PostgreSQL integration tests; GitHub Actions; a deployed read-only demo; and a concise README showing architecture, source limitations, and one measured result. The job application can then cite a working artifact rather than planned features. Do not publish resume bullets for unfinished stages.

### Stage 1 — Data audit and foundation (week 1)

Keep v2/v3 as historical context. Bootstrap the npm workspace, local PostgreSQL/Docker Compose, migrations, CI, and benchmark harness. Create the private `app` schema, limited runtime role, and migration role. Download the versioned HSB archive, verify its checksum and licence, inspect the data dictionary, record a source-field map, and quantify eligible apartments/periods/coverage. Implement a deterministic local importer and prepare a small verified subset for later hosting in Stage 4. If no complete common billing window exists, activate the explicit illustrative-fixture fallback rather than altering observed rows.

**Gate:** a clean install works; the source audit states row counts, mappings, units, missingness and chosen billing window (or fallback); migrations/imports are repeatable; database grants block application access outside its schema; `npm run verify` is green.

### Stage 2 — Reliable ingestion (week 2)

Implement the **same authenticated HTTP batch contract** first with one PostgreSQL INSERT per published HSB source event, then save a baseline before changing its write path. Optimize batch persistence without changing accepted input, validation, idempotency semantics, or response format. Reset a separate benchmark database to the same starting state for each run; use identical HTTP payloads, row count, concurrency, and machine settings. Add structured batch logs and a durable duplicate/conflict report. The Stage 1 local CLI is not the HTTP baseline.

**Gate:** 10,000 replayed historical **source events** create no duplicate inserts; a reused key with changed content is recorded and reported as a conflict; accepted rows survive a server restart; every rejected row has a reason; baseline and final HTTP results are reproducible on clean matched states.

### Stage 3 — Billing and minimal UI (weeks 3–4)

Implement fictional-fixture allocation as pure functions, preview, transactional publication, revisions, and manager/resident views. Make the separation between HSB event analytics and fictional-fixture billing unmissable. Record the query baseline before adding its optimization; add auth and cross-apartment security tests before deployment.

**Gate:** all published statements reconcile exactly; missing/ambiguous source coverage blocks real-data claims; invalid periods cannot publish; retries and concurrent requests do not duplicate statements; prior revisions remain readable; cross-apartment reads are denied; both roles complete their Playwright flows.

### Stage 4 — Explanation, release, and evidence (weeks 5–6)

Implement Groq structured output and fallback, evaluate labeled bill cases, run final benchmarks and a fault drill, deploy, write the README/runbook and engineering workflow note, and generate result-backed resume bullets.

**Gate:** at least 30 frozen labeled explanation cases are evaluated against the template baseline; no displayed figure comes from model text; Data API access to application tables is blocked; deployed demo works at ₹0; a fault drill demonstrates diagnosis using logs/health signals; results include reproducibility metadata and every resume claim links to evidence.

## 7. Free-tier deployment notes

The concrete Stage 4 sequence, service settings, database/Auth migration, seed boundary, smoke checks, and release evidence are in [docs/DEPLOYMENT_PLAN.md](docs/DEPLOYMENT_PLAN.md). It remains a plan until the account-level capability checks and deployed gate pass. The current local PostgreSQL connection/setup code needs Supabase session-pooler usernames, SSL, and managed-role verification before cloud deployment; Render will use the audited 1,000-row CSV prefix included in the image, not the ignored full archive.

Use Render Free for Express and a separate static React site, Supabase Free for PostgreSQL and Auth, and Groq Free for explanations. Configure environment variables in the services, never in Git. Set up Supabase asymmetric Auth signing, disable its Data API for application tables, and test the session-pooler connection from Render before relying on deployment. Keep the hosted seed small; run scale benchmarks locally. Check current provider quotas at deployment and do not add payment methods.

Render Free sleeps after inactivity, so measure cold-start time separately from warm API latency. Supabase Free may pause after low activity; the static demo snapshot remains available, and the runbook explains manual resume. Groq rate limits vary by account; cache explanations and handle `429` without changing billing. See [Render Free](https://render.com/docs/free), [Supabase Free pricing](https://supabase.com/pricing), [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), and [Groq rate limits](https://console.groq.com/docs/rate-limits).

After v1 is complete and measured, add MQTT behind the meter adapter if it strengthens the portfolio story. Select a currently available broker then; the HiveMQ Cloud Serverless option in v2 can no longer be created and retires on December 31, 2026. See [HiveMQ's notice](https://docs.hivemq.com/hivemq-cloud/serverless-end-of-life.html).
