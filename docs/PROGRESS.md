# Smart Water Metering Platform — Progress

**Updated:** 2026-10-30
**Status:** Stage 4 release gate passed for deployed commit `fbe71f3`
**Source of truth:** WATER_METERING_BUILD_PLAN_v4.md in the repository root

This is the handoff record for implementation across separate coding chats. Update it at the end of every phase and whenever a gate fails. A status of “done” requires evidence, not only code changes.

## Phase tracker

| Phase | Status | Exit evidence |
|---|---|---|
| Planning and v4 alignment | Done | v4 plan, architecture design, current questions, and kickoff prompt |
| Stage 1 — Data audit and foundation | Done, local gate passed | `docs/data/HSB_AUDIT.md`, profile/manifest JSON, frozen install, migrations/grant tests, `docs/data/stage1-verify.txt` |
| Stage 2 — Reliable ingestion | Done, modular local gate passed | `RESULTS.md`, modular HTTP baseline/final JSON with executed module paths and SHA-256, mode-selection check, 12 passing tests, `docs/data/stage2-modular-refactor-verify.txt`; earlier raw evidence preserved |
| Stage 3 — Billing and minimal UI | Done, repaired local gate passed | Migration 008, preserved-history inventories, 23 Vitest tests, 2 Playwright flows, `docs/data/stage3-duplicate-repair-verify.txt` |
| Stage 4 — Groq, operations, release | Done, release gate passed for deployed `fbe71f3` | [gate result](data/stage4-gate.json), [32-case Groq evaluation](../tools/bench/results/stage4-explanations-v4.json), [fault drill](data/stage4-fault-drill.json), [deployed API](data/stage4-deployed-api-smoke.json), [React](data/stage4-deployed-web-smoke.json), [model/cache](data/stage4-deployed-model-smoke.json), [cold/warm timing](data/stage4-deployed-timings.json), [green CI/Free resources](data/stage4-release-resources.json) |

## Current focus

Stage 4 has a resident-authorized explanation endpoint, frozen fictional-case evaluation, local fault drill, tested hosted Supabase roles/Auth, and 1,000-row historical HSB subset import. The Render Free API and static site are deployed and passed API, browser, revision, Groq, cache, fallback, and separate cold/warm timing checks. The explicit Stage 4 gate passed for deployed commit `fbe71f3`. The 10,000 Stage 2 HTTP benchmark rows remain replayed historical HSB source events and are not coverage-certified billing readings.

## Decisions and limitations

- The v4 plan is authoritative. Earlier v2/v3 plans and their old question log are archived for reference.
- Published HSB measurements are historical observed input. HTTP replay is a test/import method, not live telemetry. The source filters zero readings and supplies no heartbeat/status mask, so 0 apartments and 0 periods qualify for measured billing from this file. Stage 3 uses a separate illustrative test fixture.
- The actual pinned Zenodo version is 1.1.0; v4 now uses that label. The dictionary calls `value` litres, while the summed column and cleaning threshold support m³; the adapter records this inference and the discrepancy stays open in Q-05.
- Decision 002 resolves Q-06: `row_sha256` follows `hsb-parsed-fields-json-v1` (all 16 parsed string fields in header order), not raw bytes. Adapter 1.0.0 and Stage 1 stored rows were preserved; the 1,000-row HTTP replay classified every row as duplicate.
- The dataset has no matching utility invoice or physical building main-meter series. Demo invoices and allocation comparisons are illustrative.
- Stage 2 has a local ingestion comparison in `RESULTS.md`. Any resume claim must retain the local HTTP benchmark scope, published historical-row replay wording, and saved raw result trace.

## Evidence register

| Claim candidate | Current state | Required artifact |
|---|---|---|
| Ingestion throughput improvement | Current modular local comparison: 10,473.4 to 58,347.6 median events/s (5.57×); prior 6.23× is pre-refactor history | `tools/bench/results/stage2-http-baseline-modular-2026-10-28.json`, `stage2-http-final-modular-2026-10-28.json`; generated `RESULTS.md` |
| Idempotency/reliability | Verified locally: 10,000 duplicates on replay, 0 new rows, 1 durable changed-key conflict in both current benchmark modes; original 1,000-row import replayed as duplicates | Modular raw HTTP result JSON, `stage1-http-replay.json`, `docs/data/stage2-modular-refactor-verify.txt` |
| Billing reconciliation and access control | Unmeasured | PostgreSQL integration tests and statement audit output |
| Counterfactual allocation | HSB measured-billing route ruled out by source semantics | Separate labeled Stage 3 test fixture and explicit illustrative invoice assumptions |
| Groq reason agreement and call reduction | 32/32 accepted/agreeing Groq outputs on frozen fictional cases; two actual repeat model calls avoided in hosted Supabase/local API smoke | `tools/bench/results/stage4-explanations-v4.json`, `docs/data/stage4-hosted-local-api-smoke.json` |
| CI/operational diagnosis | `CI=true npm run verify` passes locally with 29 tests and two Playwright flows; actual GitHub Actions run 40619499702 succeeded for deployed commit 596f88f; injected drill and 11 matched deployed request-ID logs recorded | `docs/data/stage4-verify-final.txt`, `docs/data/stage4-fault-drill.json`, `docs/data/stage4-release-resources.json`, `docs/data/stage4-render-log-evidence.json` |

## End-of-chat handoff checklist

For every implementation chat, the coding agent must update this file before its final response:

1. Record the exact phase, completed work, and gate status.
2. List changed files and design decisions; update ARCHITECTURE_DESIGN.md if behavior or boundaries changed.
3. Record exact commands and results for tests, builds, benchmarks, and deployment smoke checks. Link raw evidence paths; do not hand-enter unsupported numbers.
4. Record unresolved issues in QUESTIONS.md with the next action and owner. Remove or close resolved entries.
5. State the next smallest task and what the next coding chat should read first.

## Stage 1 handoff (historical)

**Phase:** Stage 1 — data audit and foundation. **Gate:** Passed locally on 2026-10-28. No Stage 2 work was implemented.

**Changed files:** Root workspace/lockfile, `eslint.config.mjs`, `.env.example`, `compose.yaml`, `Dockerfile`, `.dockerignore`, `.gitignore`, `vitest.config.mts`, `.github/workflows/verify.yml`; `apps/server`, `apps/web`, `packages/shared`, `packages/db` (two forward migrations, role setup, migration runner, grant/constraint tests); `tools/import-hsb` (profile, adapter, CLI, audited 1,000-row prefix, tests); `tools/fault-fixtures/billing-demo.json` (separate, fictional fallback input); `tools/bench/README.md` and results placeholder; `README.md`, `RESULTS.md`, `docs/requirements.md`, `docs/engineering-workflow.md`, `docs/data/`, and decision 001. `docs/ARCHITECTURE_DESIGN.md` now reflects source events and the billing fallback; `docs/QUESTIONS.md` closes Q-01–Q-03 and records Q-05.

**Source evidence:** [audit](data/HSB_AUDIT.md), [full profile and 214 sensor mappings](data/hsb-profile.json), [first import manifest](data/hsb-import-small.json), [replay manifest](data/hsb-import-repeat.json). Zenodo MD5 `1db6a143f39da53710e63c6bb353d5b1` matched the downloaded ZIP; local ZIP SHA-256 is `ff766b30d05e65c2477fc929d56a112d5b0775619075daa2bd6dd687c57c7c89`. The first import committed 1,000 events, 0 duplicate, 0 rejected. Identical replay committed 0 new events, 1,000 duplicates, 0 rejected. Both manifests label billing coverage ineligible. No ingestion throughput benchmark or resume metric was produced.

**Exact local gate commands and outcomes:**

```sh
rm -rf node_modules apps/server/node_modules apps/web/node_modules packages/shared/node_modules packages/db/node_modules tools/import-hsb/node_modules
CI=true pnpm install --frozen-lockfile                  # exit 0 from clean generated-dependency state; 229 packages linked
docker compose up -d --wait                            # exit 0; PostgreSQL healthy
CI=true pnpm db:setup                                  # exit 0; distinct roles and private app schema
CI=true pnpm db:migrate                                # exit 0; 001 then 002 applied; later rerun no-op
CI=true pnpm db:check                                  # exit 0; app_rw cannot create in app or use public
python3 tools/import-hsb/profile.py /private/tmp/hsb-stage1/HSB_Living_Lab_Water_Consumption_Anonymized.csv --out docs/data/hsb-profile.json
                                                       # exit 0; 652315 rows, 214 stable sensor mappings
CI=true pnpm hsb:import --archive /Users/harsh/Downloads/HSB_Living_Lab_Data_Package.zip --csv tools/import-hsb/fixtures/hsb-sample-1000.csv --limit 1000 --out docs/data/hsb-import-small.json
                                                       # exit 0; accepted 1000, duplicate 0, rejected 0
CI=true pnpm hsb:import --archive /Users/harsh/Downloads/HSB_Living_Lab_Data_Package.zip --csv tools/import-hsb/fixtures/hsb-sample-1000.csv --limit 1000 --out docs/data/hsb-import-repeat.json
                                                       # exit 0; accepted 0, duplicate 1000, rejected 0
pnpm verify                                            # exit 0; lint, 5/5 tests, type checks, grant check, builds
pnpm audit --audit-level high                          # exit 0; no known vulnerabilities
docker build -t water-stage1-local .                  # exit 0; image built
```

The final verification output is [stage1-verify.txt](data/stage1-verify.txt); dependency audit output is [stage1-audit.txt](data/stage1-audit.txt). The first import manifest predates the added CSV SHA-256 manifest field; the later replay manifest includes it, and the audited subset checksum is in the source audit. The repository still has **no commits**. The GitHub Actions workflow file exists, but **no GitHub Actions run has passed or even run**.

**Blockers and limits:** No local Stage 1 gate blocker. Q-05 remains open for publisher clarification before any measured-volume billing claim; Q-04 is a Stage 4 cloud capability check. The source's missing zero/heartbeat data permanently blocks coverage-certified billing from this archive; decision 001 chooses the separated illustrative-fixture fallback. No cloud deployment or bill calculation has been attempted.

**Supervisor review (2026-10-28):** Independently reran `pnpm verify` with local PostgreSQL access: lint, type checks, runtime-grant check, 5/5 tests, and builds passed. GitHub Actions still has no run because the repository has no commits. Updated v4, AGENTS.md, source audit, decision 001, and architecture language to match the Stage 1 event/fictional-billing finding. No Stage 2 implementation or performance claim was added.

**Next chat:** Read `AGENTS.md`, v4, this progress file, the architecture design, questions, HSB audit, and decision 001. Implement Stage 2 only: save a matched HTTP single-insert baseline before optimizing; replay 10,000 HSB source events; add authenticated durable event batch ingestion, replay/conflict handling, logs, and reproducible final benchmark. Keep HSB event semantics and source provenance explicit.

## Original Stage 2 handoff — 2026-10-28 (benchmark comparison superseded)

**Phase and gate at the time:** Stage 2 — reliable ingestion. The API correctness gate passed locally, but the performance comparison below was invalid because both modes executed the final module. The corrected evidence is in the repair handoff below. **Original claim withdrawn.** The authenticated source-event API committed accepted events and durable conflict records before responses; 10,000 published rows replayed as 10,000 duplicates with zero new rows; a changed payload under an existing key created one durable conflict. Accepted rows survived app restart in the PostgreSQL integration test. This is a local gate only. No Git commit exists and GitHub Actions has not run; CI is not green.

**Changed implementation:** `packages/shared/src/hsb.ts` now owns the documented versioned hash and HSB adapter shared by importer and HTTP path. `apps/server/src/ingest.ts` implements the bounded, credential-protected batch endpoint, pinned manifest/CSV line/sensor verification, server-derived provenance, transactions, per-item reason codes, readiness, and batched persistence. `apps/server/src/index.ts` sends structured request and batch records through pinned Pino 10.4.0 without credential or usage fields. `packages/db/migrations/003_ingestion_batches.sql` adds append-only batch/conflict tables without rewriting applied migrations. `apps/server/src/ingest.test.ts` covers authentication, bounds, validation, out-of-order and repeated timestamp rows, duplicates/conflicts, partial rejection, rollback, and restart retry. `Dockerfile` includes the benchmark workspace package for the frozen lockfile. `tools/bench/baseline-source/` freezes the single-INSERT HTTP baseline source saved before optimization. Decision 002 and `docs/API_SOURCE_EVENTS.md` record the new boundary. No billing, Groq, or full UI work was added.

**Commands and outcomes:**

```sh
node --import tsx tools/bench/prepare.ts
POSTGRES_DB=water_metering_bench CI=true pnpm db:setup
POSTGRES_DB=water_metering_bench CI=true pnpm db:migrate
node --import tsx tools/bench/http.ts baseline tools/bench/results/stage2-http-baseline.json
HSB_CSV_PATH=/private/tmp/hsb-stage2/HSB_Living_Lab_Water_Consumption_Anonymized.csv node --import tsx tools/bench/http.ts final tools/bench/results/stage2-http-final.json
node --import tsx tools/bench/report.ts
node --import tsx tools/bench/replay-stage1.ts
CI=true pnpm verify
docker build -t water-stage2-local .
docker run --rm --entrypoint node water-stage2-local -e "import('./apps/server/dist/ingest.js').then(() => console.log('Node 24 server module loads'))"
```

All listed commands exited 0 in the local environment. `pnpm verify` passed lint, type checks, database role check, 11/11 tests across three files, and builds; the Docker image and Node 24 module-load check also passed. Full verification output is [stage2-verify.txt](data/stage2-verify.txt). Benchmark JSON files hold one warm-up plus five measured 10,000-row runs for each path, all request latencies, per-run throughput/p50/p95, machine and software metadata, scenario hash, and clean reset procedure. The originally reported 10,665.6 versus 64,189.3 events/s and 6.02× ratio is **withdrawn**: both modes executed `apps/server/src/ingest.ts`. The [historical baseline](../tools/bench/results/stage2-http-baseline.json) and [historical final](../tools/bench/results/stage2-http-final.json) remain unchanged for audit. Use the corrected files and [RESULTS.md](../RESULTS.md) below for any performance claim. The [original Stage 1 HTTP replay](../tools/bench/results/stage1-http-replay.json) added 0 rows and classified 1,000 duplicates.

**Unresolved:** Q-05 publisher unit discrepancy remains open and prevents certified measured-volume billing claims. Q-04 is a Stage 4 provider check. The HSB archive cannot certify a billing period because zero-use rows and status masks are absent. The benchmark is local and does not predict hosted throughput. No commit or GitHub Actions run exists.

**Next action:** Read `AGENTS.md`, v4, this progress file, architecture design, questions, source audit, decisions 001 and 002. Implement Stage 3 only from the separate fictional fixture; preserve HSB event analytics isolation, exact integer allocation, publication revisions, access tests, and the Stage 3 gate.

## Stage 2 evidence repair — 2026-10-28

**Gate:** Passed locally after correcting the benchmark mode selection. No Stage 3 work began. The previous 6.02× comparison is withdrawn because `tools/bench/http.ts` imported the final `createIngestApp` for both labels and only changed the reported SHA. The old raw JSON files remain unchanged as historical evidence. The corrected harness dynamically imports the frozen single-insert implementation for `baseline` and the current batched implementation for `final`, records the actual absolute path and SHA-256, and fails on wrong or swapped selection. It pins the frozen/current shared adapter, compiled adapter, profile, and migrations 001–003, and checks the applied migration versions. `tools/bench/*.ts` is linted and strictly type-checked; `pnpm bench:check` exercises the mode selector and checksum guards. The immutable baseline source snapshot is not edited or linted.

**Corrected measured evidence:** [baseline raw JSON](../tools/bench/results/stage2-http-baseline-repair-2026-10-28.json), [final raw JSON](../tools/bench/results/stage2-http-final-repair-2026-10-28.json), and generated [RESULTS.md](../RESULTS.md). Both used the same verified HSB 1.1.0 CSV SHA-256 `e9b8f34245b5cfb2b43d8fe3274056bcc5f3dca0cbf8904a6c4227ddd42d0be8`, 10,000 rows, HTTP batches of 500, concurrency 4, Apple M2/8 GB/macOS 27.0.0, Node 26.12.1, PostgreSQL 18.1, and the same isolated database truncation/manifest seeding before each run. Each path had one warm-up and five measured runs. Across-run median throughput: **11,078.8 events/s single-insert** (10,642.4–11,162.2) versus **69,061.5 events/s batched** (63,701.8–69,862.4), a **6.23× local ratio**. Median request p50: 178.5 versus 26.7 ms; median request p95: 187.5 versus 40.3 ms. Both modes accepted 10,000 in every measured run, then replayed all 10,000 as duplicates with zero new rows and recorded one changed-key conflict. Every number is derived from the new raw files; the old files are excluded from the report generator.

**Exact local commands and outcomes:**

```sh
CI=true pnpm --filter @water/shared build
CI=true pnpm bench:check
docker compose up -d --wait
POSTGRES_DB=water_metering_bench CI=true pnpm db:setup
POSTGRES_DB=water_metering_bench CI=true pnpm db:migrate
shasum -a 256 /private/tmp/hsb-stage2/HSB_Living_Lab_Water_Consumption_Anonymized.csv /Users/harsh/Downloads/HSB_Living_Lab_Data_Package.zip
HSB_CSV_PATH=/private/tmp/hsb-stage2/HSB_Living_Lab_Water_Consumption_Anonymized.csv node --import tsx tools/bench/http.ts baseline tools/bench/results/stage2-http-baseline-repair-2026-10-28.json
HSB_CSV_PATH=/private/tmp/hsb-stage2/HSB_Living_Lab_Water_Consumption_Anonymized.csv node --import tsx tools/bench/http.ts final tools/bench/results/stage2-http-final-repair-2026-10-28.json
node --import tsx tools/bench/report.ts
CI=true pnpm verify
```

All exited 0. [Saved verification output](data/stage2-evidence-repair-verify.txt) shows lint, strict type checks including `tools/bench`, runtime database grants, 11/11 tests, the focused mode-selection check, and builds passed. This is local evidence only: the repository has no commit and GitHub Actions has not run, so CI is not green. The HSB archive still lacks a coverage-certified billing period; Q-05 source-unit clarification and Q-04 Stage 4 provider checks remain open. No architecture boundary or open question changed in this repair.

**Next action:** In a separate Stage 3 chat, read `AGENTS.md`, v4, this progress file, architecture design, questions, source audit, and decisions 001–002. Implement only the separate fictional-fixture billing and minimal UI, exact integer reconciliation, immutable revisions, authorization tests, and the Stage 3 gate.

## npm workspace migration — 2026-10-28

**Scope and gate:** The user chose npm for the current repository. Replaced pnpm workspace configuration and lockfile with npm 11.20.0 workspaces and `package-lock.json`; updated root/workspace scripts, Docker build, GitHub Actions workflow, current plan/agent instructions, benchmark reproduction commands, and README. The former lockfile is preserved at [pnpm-lock-stage2-2026-10-28.yaml](archive/pnpm-lock-stage2-2026-10-28.yaml). The audited HSB ZIP stays at the project root as the user placed it, ignored by Git and Docker; the extracted CSV can go in ignored `data/raw/`. No ingestion or database behavior changed, and Stage 3 was not started. The corrected benchmark raw JSON and generated `RESULTS.md` were not altered or remeasured; they describe the earlier pinned pnpm environment, so the 6.23× result is historical Stage 2 evidence rather than a fresh npm-environment measurement.

**Exact local commands and outcomes:**

```sh
npm ci                                      # exit 0; 247 packages installed, 0 vulnerabilities
CI=true npm run verify                      # exit 0; lint, strict workspace types, grants, 11/11 tests, benchmark mode check, builds
npm audit --audit-level=high                # exit 0; 0 vulnerabilities
docker build -t water-npm-local .          # exit 0; Node 24 image built
npm run start:api                            # started with local environment; /healthz and /readyz returned 200; then stopped
npm run dev:web                              # started; GET / returned 200 on port 5173; then stopped
```

The verification transcript is [npm-migration-verify.txt](data/npm-migration-verify.txt). The API startup check supplied a temporary local ingestion credential and verified CSV path because the existing `.env` lacked those two values; no credential was saved in evidence. Both development servers were stopped after the smoke check. `README.md` gives the current npm setup and run commands. The repository still has no commits, and **GitHub Actions has not run**; local verification is the only gate evidence. No new unresolved question was introduced. Next action remains Stage 3 in a separate coding chat, starting with the source-of-truth and handoff files listed above.

**Archive placement correction:** Restored the user's `HSB_Living_Lab_Data_Package.zip` to the repository root after briefly moving it to `data/raw/`. `.gitignore` and `.dockerignore` exclude the root ZIP. `git check-ignore -v HSB_Living_Lab_Data_Package.zip` confirmed the Git rule; `unzip -tq HSB_Living_Lab_Data_Package.zip` found no archive errors; SHA-256 remained `ff766b30d05e65c2477fc929d56a112d5b0775619075daa2bd6dd687c57c7c89`. README now shows the root archive path and how to extract its CSV. This was a location/documentation correction; no application code or Stage 2 measurement changed.

## Stage 2 module organization — 2026-10-28

**Gate:** Passed locally for the current modular implementation. Stage 3 was not started. The user requested smaller backend and frontend modules. `apps/server/src/ingest.ts` now composes configuration, middleware, health/source-event routes, the source-event controller, Zod schemas, archive verification, and batched persistence from their subdirectories. `apps/server/src/index.ts` is a small startup entry point. `apps/web/src/main.tsx` renders `app/App.tsx`, with the current placeholder in `pages/StatusPage.tsx`. The API payload, transaction and idempotency rules, source provenance, database schema, and trust boundary were not changed. One PostgreSQL integration test was added for the full mounted route and request-ID log without the credential.

The earlier corrected Stage 2 final source was saved byte for byte at [final-source-stage2/ingest.ts](../tools/bench/final-source-stage2/ingest.ts), SHA-256 `64707f3abc1b2ea1cebf3e07b131f511aa163fe521df380f037ba4c3b56505d2`, matching its preserved raw result. The benchmark mode check now verifies the current modular route/controller/persistence chain. The old raw JSON and 6.23× pre-refactor result remain historical. [RESULTS.md](../RESULTS.md) is regenerated from the new [modular baseline](../tools/bench/results/stage2-http-baseline-modular-2026-10-28.json) and [modular final](../tools/bench/results/stage2-http-final-modular-2026-10-28.json).

The new matched HTTP comparison used the verified HSB 1.1.0 CSV, SHA-256 `e9b8f34245b5cfb2b43d8fe3274056bcc5f3dca0cbf8904a6c4227ddd42d0be8`, adapter `hsb-event-1.0.0`, 10,000 source rows, batches of 500, concurrency 4, and an isolated database reset before each warm-up and five measured runs per path. Both modes ran on the same machine and runtime recorded in raw JSON. Median throughput was **10,473.4 events/s** (10,244.5–10,859.7) for the frozen single-insert path and **58,347.6 events/s** (56,416.4–65,427.2) for the modular batched path, a **5.57× local ratio**. Median request p50 was 187.9 versus 31.6 ms; p95 was 196.8 versus 42.8 ms. Both separate 10,000-event replays added zero rows and classified every item as duplicate; each changed-key probe recorded one durable conflict. These are replayed historical source events, not live telemetry or certified billable volumes.

**Exact commands and outcomes:**

```sh
npm run bench:check
node --import tsx tools/bench/prepare.ts
POSTGRES_DB=water_metering_bench npm run db:migrate
HSB_CSV_PATH=/private/tmp/hsb-stage2/HSB_Living_Lab_Water_Consumption_Anonymized.csv node --import tsx tools/bench/http.ts baseline tools/bench/results/stage2-http-baseline-modular-2026-10-28.json
HSB_CSV_PATH=/private/tmp/hsb-stage2/HSB_Living_Lab_Water_Consumption_Anonymized.csv node --import tsx tools/bench/http.ts final tools/bench/results/stage2-http-final-modular-2026-10-28.json
node --import tsx tools/bench/report.ts
CI=true npm test -- apps/server/src/ingest.test.ts
CI=true npm run verify
docker build -t water-modular-local .
```

All exited 0. The [saved verification transcript](data/stage2-modular-refactor-verify.txt) shows lint, strict types, private-schema grant checks, **12/12 tests**, benchmark mode selection, and builds. The Docker image built with Node 24. The repository has no commits and GitHub Actions has not run, so CI is not green. Q-05 remains open for source-unit publisher clarification, and Q-04 remains a Stage 4 provider check; this refactor introduced no new unresolved issue. Next action: in a separate Stage 3 chat, read `AGENTS.md`, v4, this progress file, architecture, questions, HSB audit, and decisions 001–002; implement only fictional-fixture billing and the minimal manager/resident UI with exact reconciliation and authorization tests.

**Supervisor review (2026-10-28):** Independently reran `CI=true npm run verify` against local PostgreSQL: lint, all six workspace type checks, runtime grants, **12/12 tests**, benchmark mode selection, and builds passed. Checked that the current modular benchmark JSON records distinct executed module hashes, matched 10,000-event scenarios, zero new rows on replay, and one durable conflict per mode. Verified the root ZIP SHA-256 and extracted its CSV into ignored `data/raw/`; the CSV SHA-256 matches the audited source. This review did not rerun the HTTP load benchmark, so the current measured claim remains the saved **5.57× local ratio**. The local `.env` still needs `INGESTION_CREDENTIAL` and `HSB_CSV_PATH` before starting the API through `npm run start:api`.

**Deployment planning (2026-10-28):** Added [docs/DEPLOYMENT_PLAN.md](DEPLOYMENT_PLAN.md) and linked it from v4, README, and architecture. It specifies the Stage 4 Render API/static-site, Supabase PostgreSQL/Auth, Groq, small verified HSB seed, cloud connection/SSL changes, environment separation, smoke tests, and release evidence. No cloud resource was created or tested; Q-04 remains open for account-specific checks. Stage 3 remains the next coding stage.

## Stage 3 handoff — fictional billing and minimal UI (2026-10-28)

**Gate:** Passed locally. Stage 3 uses only `tools/fault-fixtures/billing-demo.json`: two fictional flats, six declared intervals, 5,000 mL total, Asia/Kolkata boundaries, no physical main meter or shared bucket. The illustrative example invoice is 500 paise variable plus 200 paise fixed. HSB `source_events` are never joined or queried by billing. No Groq integration or cloud deployment was attempted.

**Changed implementation:** Forward-only migrations `004_fictional_billing.sql` through `007_billing_period_list_index.sql` add private societies/flats/profiles, drafts, immutable published revisions/statements/lines, idempotency, audit events, least-privilege grants, second-society isolation fixture support, and the period-list index. Applied migrations 001–003 and all Stage 2 raw benchmark evidence were preserved. `apps/server/src/billing/allocation.ts` validates complete fixture coverage and period boundaries and calculates exact integer largest-remainder allocations; `apps/server/src/billing/api.ts` verifies asymmetric JWTs, loads roles/society/flat from PostgreSQL, and implements the manager and resident endpoints. `apps/server/src/routes/source-analytics.ts` returns a pinned, read-only HSB event summary with coverage caveat, never a bill. `apps/server/src/ingest.ts`, `config/`, `index.ts`, and request context mount those routes beside the unchanged source-event batch API. `apps/web/src/app/App.tsx`, `pages/StatusPage.tsx`, `style.css`, `vite-env.d.ts`, and `vite.config.ts` provide Supabase sign-in, manager draft/preview/publish/revision controls, resident statements, and separate source/fictional panels. `tools/fault-fixtures/seed-billing.ts` creates local fictional profiles only; `playwright-api.ts` signs local ES256 tokens that pass the same server verifier. `playwright.config.ts` and `apps/web/e2e/roles.spec.ts` exercise both UI roles. `package.json`, `package-lock.json`, `.env.example`, `.gitignore`, `.github/workflows/verify.yml`, and web tsconfig carry the pinned dependencies, test scripts, public configuration, and CI browser setup. README, `docs/API_BILLING.md`, architecture, questions, engineering workflow, and `RESULTS.md` were updated.

**Gate commands and outcomes:** `npm run db:migrate` applied migrations 004–007 to the main local database without modifying prior migrations. `npm run billing:seed` inserted local fictional-only societies, flats, and profile IDs. `POSTGRES_DB=water_metering_bench npm run db:migrate` applied the same forward migrations to the isolated test database; `POSTGRES_DB=water_metering_bench npm run billing:seed` inserted test identities there. `npm run bench:billing -- before` ran before migration 007; `npm run bench:billing -- after` ran after it. A clean `npm ci` exited 0, installed 268 packages, and reported zero audit vulnerabilities. Final `CI=true npm run verify` exited 0; [saved transcript](data/stage3-verify.txt) shows lint, strict type checks, private-schema grant check, 20/20 Vitest tests across five files, Stage 2 benchmark mode check, all workspace builds, and 2/2 Playwright flows. Destructive billing-test resets now target only `water_metering_bench`; verification does not truncate the main database's published statements. The 20 tests cover allocation ties and property sums, zero use, missing/ambiguous fixture coverage, period offset, invoice mismatch, stale preview, same-key retries, distinct-key concurrent publication, revision immutability, role denial, and cross-flat/cross-society reads. These are local results; GitHub Actions has not run because the repository has no commit.

**Query evidence:** The [before JSON](../tools/bench/results/stage3-billing-query-before.json) and [after JSON](../tools/bench/results/stage3-billing-query-after.json) record the same manager-list query, 2,001 rows in one fictional society including 2,000 generated rows in a rolled-back transaction, full `EXPLAIN (ANALYZE, BUFFERS)` plans, and sample times. The observed plans changed from sequential scan plus sort (0.435 ms) to index scan (0.017 ms). These are one-shot local query observations, not a reproducible throughput or resume-speedup claim; request p50/p95 and five-run spread have not been measured. [RESULTS.md](../RESULTS.md) ties both fields to their raw files. Any future query-performance resume claim needs a matched repeated HTTP benchmark.

**Blockers and Stage 4 handoff:** No local Stage 3 gate blocker. Q-04 remains the account-specific free-tier, managed-role, SSL, and deployment check; Q-05 remains the publisher-unit discrepancy that prevents certified HSB billing; Q-07 records the need to create actual Supabase Auth users and provision their returned UUIDs into `app.profiles`. The fixed local IDs are fictional test identities, not cloud users. Stage 4 must evaluate Groq with frozen cases, add the fault drill and runbook, adapt hosted DB settings, verify Data API denial, obtain a real green GitHub Actions run, and deploy only after the account checks. Do not relabel this local gate as a deployed release.

**Supervisor review (2026-10-28; supersedes the Stage 3 gate claim above):** Independently ran `CI=true npm run verify`; lint, types, grants, 20/20 Vitest tests, benchmark mode check, builds, and 2/2 Playwright flows passed. A rolled-back probe using the limited `app_rw` role inserted **two distinct `app.billing_periods` rows for the same `fictional-demo` society and identical fixture window**. Migration 004 has no society/window uniqueness constraint, and `POST /api/v1/billing-periods` creates a new ID on every request. Publication locks only its own period row, so these two drafts can each publish statements for the same hour. This violates the intended one-invoice-per-period behavior and leaves the Stage 3 no-duplicate gate open. Repair with a forward-only migration, an explicit duplicate/overlap policy and API conflict response, and a concurrent-create plus publish test. Preserve all existing published revisions and Stage 2 evidence; rerun the full Stage 3 gate before moving to Stage 4. The probe transaction was rolled back and left no duplicate rows.

## Stage 3 duplicate-period repair handoff (2026-10-28)

**Gate:** Passed locally after the supervisor finding. The rule is one active billing period per society and exact UTC `[start,end)` window. The fixed fictional fixture accepts only its single Asia/Kolkata hour; a different society can use that same hour. Historical duplicate rows remain audit-only and cannot be previewed, published, or revised. The prior supervisor review remains above as the failure record; this repair supersedes its pending status.

**Preflight and migration:** Before migration, a read-only [inventory](data/stage3-duplicate-preflight.txt) found two published `fictional-demo` periods for the identical window, with 3 revisions, 6 statements, 18 statement lines, and 4 audit events. These were existing local fictional billing rows, separate from the supervisor's rolled-back probe. Forward-only `packages/db/migrations/008_one_active_billing_window.sql` retained the earliest published period as active and marked the later period with `superseded_by_period_id`. Its partial unique index enforces the active society/window key; column-scoped `app_rw` grants prevent marking a new row audit-only to bypass it. `npm run db:migrate` and `POSTGRES_DB=water_metering_bench npm run db:migrate` each applied 008 successfully. The [post-migration inventory](data/stage3-duplicate-postmigration.txt) shows zero duplicate active windows and unchanged counts of all 3 revisions, 6 statements, 18 lines, and 4 audit events. No old migration or Stage 2 evidence was edited.

**Changed code and tests:** `apps/server/src/billing/api.ts` uses the unique index as the concurrent-create arbiter, returning 409 `billing_period_exists` with the existing active period ID/status. It excludes audit-only periods from ordinary lists, rejects their manager mutations, and keeps historical resident statement detail readable. `apps/web/src/app/App.tsx` loads the current manager draft on sign-in and refresh; the Playwright manager flow now reloads before preview. `apps/server/src/billing/api.test.ts` adds sequential and concurrent duplicate-create tests, direct database uniqueness and marker-grant checks, cross-society independence, audit-only publication/revision denial, and a historical statement read. `packages/db/src/schema.test.ts` checks the marker grants. `docs/API_BILLING.md`, `docs/ARCHITECTURE_DESIGN.md`, `docs/QUESTIONS.md`, and the v4 status were updated for the exact-window and legacy-history policy.

**Exact gate command and outcome:** `CI=true npm run verify` exited 0. The [raw transcript](data/stage3-duplicate-repair-verify.txt) records lint, strict type checks, runtime grant check, 23/23 Vitest tests in five files, Stage 2 benchmark mode check, all workspace builds, and 2/2 Playwright flows. This is a local gate; no GitHub Actions run, Groq work, or cloud deployment occurred.

**Limits and next action:** The unique index covers exact window equality among active periods. Partially overlapping distinct windows remain outside this fixture-bound API; no broader overlap policy was implemented in this narrow repair. Q-04 and Q-07 remain Stage 4 cloud checks; Q-05 remains the HSB source-unit caveat. Stage 4 is next, with Groq evaluation, hosted Auth/profile provisioning, operational drills, a real CI run, and deployment checks. Do not describe this local repair as a deployed release.

## Stage 4 in-progress handoff — 2026-10-28

**Gate:** Open. The explanation, fault-drill, hosted Supabase/Groq, and local verification portions passed. Render deployment, an actual green GitHub Actions run for the deployed commit, deployed API/React smoke, and cold/warm timings remain required before release. Earlier Stage 1–3 evidence and all applied migrations/published revisions were preserved.

**Implementation:** Forward migration 009 adds a private revision/facts/model/prompt keyed explanation cache. The resident-only endpoint reads the requested published fictional statement and its prior revision under database profile authorization, calls Groq `openai/gpt-oss-20b` in documented strict JSON schema mode outside any database transaction, validates reason and references with Zod, rejects numeric model prose, and renders all figures in backend code. It bounds retries, timeout, and per-process/per-resident new-call rates and falls back deterministically. React requests explanations only on a resident click. Hosted configuration adds project-qualified usernames, TLS, a three-connection runtime pool, a controlled managed-role/schema bootstrap, and a 1,000-row-only checksum-verified HSB importer. The local role setup script was never run against Supabase.

**Saved results:** The 32 frozen fictional cases have SHA-256 `c14b04b404c2b7cf1d98d02be8fe512012edddd7a4b1b53ec4b5f7b3324c8554`. [Final raw Groq evaluation](../tools/bench/results/stage4-explanations-v4.json) shows 32/32 accepted, 32/32 primary-reason agreement, zero fallbacks/rejections, and per-case output/latency/tokens; v2 and v3 attempts remain saved as tuning history. [Fault drill](data/stage4-fault-drill.json) has nine bounded request-ID logs and injected database outage, 429/timeout, duplicate replay, and stale preview results. Supabase Free session-pooler TLS/custom roles, asymmetric JWKS, migrations 001–009, private-schema grant check, and three actual fictional Auth users were account-tested. The [hosted HSB import](data/stage4-hosted-hsb-import.json) accepted exactly 1,000 audited historical events and [replay](data/stage4-hosted-hsb-replay.json) added zero. [Hosted Supabase/local API smoke](data/stage4-hosted-local-api-smoke.json) passed 23 checks across manager/resident roles, two fictional statement revisions, Groq response/cache, and Data API denial (HTTP 406 anonymous and resident). Two actual repeat Groq HTTP calls were avoided by cache; this is not a token or monetary saving claim.

**Commands and outcomes:** `npm run db:hosted-prepare`, `npm run db:migrate`, `npm run db:check`, two bounded `npm run hsb:import -- --archive HSB_Living_Lab_Data_Package.zip --csv tools/import-hsb/fixtures/hsb-sample-1000.csv --limit 1000 --out ...` runs, `node --import tsx tools/fault-fixtures/create-hosted-auth-users.ts`, `npm run billing:seed-hosted`, and `node --import tsx tools/fault-fixtures/hosted-smoke.ts` exited 0 with hosted credentials in ignored `.env`. `CI=true npm run verify` with preserved local database credentials exited 0; [transcript](data/stage4-verify-final.txt) shows lint, types, grants, 29/29 Vitest tests, benchmark guard, builds, and 2/2 Playwright flows. The first verify attempt failed only because the hosted smoke API still held port 3001; it was stopped before the passing rerun. A pre-commit scan of 158 candidate files found zero local credential values and excluded `.env`, its backup, the root ZIP, and `data/raw/`.

**Next action:** Obtain Render Free API/static-site capability, push a reviewed commit, confirm its actual green GitHub Actions run, deploy the same commit, and save deployed smoke plus separate cold/warm timings. Q-04 tracks that remaining gate; Q-05 remains a non-blocking source-unit caveat. Do not call this a completed Stage 4 release until the deployed conditions pass.

### Stage 4 deployed continuation — 2026-10-28

**Release state:** Render Free deployment and deployed smoke passed; the final gate remains open until separate idle cold-start/warm timings are saved and the final commit's CI/deployment are reviewed. The API is `https://aqualedger-api.onrender.com`, and React is `https://aqualedger-demo.onrender.com`. Both initial services deployed `596f88f703e641754dc77ffe8483abc17cf72037`; [GitHub Actions run 40619499702](https://github.com/harshgmrn04-byte/AquaLedger/actions/runs/40619499702) completed successfully. [Resource evidence](data/stage4-release-resources.json) records the explicit Free API plan and static site's included Starter build pipeline. No payment method or paid tier was added by this work.

**Deployed checks:** [API smoke](data/stage4-deployed-api-smoke.json) passed 18 bounded checks for 200 health/readiness, 401 unauthenticated, 403 cross-role, fictional statement revisions, cache responses, and 406 Data API denial for anonymous and resident. [Static asset/route smoke](data/stage4-deployed-site-smoke.json) passed root and direct `/manager`/`/resident` routes plus the built bundle; checked server secrets were absent from that bundle. The first deployed headless browser sign-in failed because Render had saved the exact `WEB_ORIGIN` but had not rolled it out. A deploy-only restart of the same green build corrected CORS; [browser smoke](data/stage4-deployed-web-smoke.json) then passed fictional manager, resident A, and resident B views and own-flat isolation. [Model smoke](data/stage4-deployed-model-smoke.json) created fictional revision 3, preserved revision 1, obtained two actual Groq selections, served two repeats from cache, and returned a deterministic 200 `request_limit` fallback for a third uncached request from the same resident. Across the API and model smoke, six repeat Groq calls were avoided by cache; no token or monetary saving is claimed. [Render logs](data/stage4-render-log-evidence.json) matched 11/11 model-smoke request IDs with only bounded route/status/duration/failure-category fields saved.

**Next action:** Rerun `CI=true npm run verify` after the final code/docs edits, push a reviewed follow-up commit, obtain its actual green Actions run, deploy that commit, measure an idle cold request separately from a warm request, and update the release gate from saved results. Preserve all fictional statement revisions and the historical HSB subset.

### Stage 4 release gate result — 2026-10-30

**Status:** Passed for deployed commit `fbe71f324d9fc0edd319c014f452390b94b5cd6a`. Both Render Free services reported that commit live, and [GitHub Actions run 40621416569](https://github.com/harshgmrn04-byte/AquaLedger/actions/runs/40621416569) completed successfully. The deployed API and React URLs are in [resource evidence](data/stage4-release-resources.json). [Artifact exclusion](data/stage4-artifact-exclusion.json) confirms the checked-in 1,000-row HSB subset matches the hosted import manifest checksum while `.env`, the root ZIP, and `data/raw/` are absent from the deployed Git tree and Docker context. [Deployed source smoke](data/stage4-deployed-source-smoke.json) returned 1,000 historical events with `coverageCertified: false` and a 204 exact-origin CORS preflight; no resident usage figure was saved in that smoke artifact.

**Cold and warm observations:** Render application logs showed no later request than 2026-10-28 03:27:34 UTC in the most recent log page before the 2026-10-30 timing probe. [Raw timing evidence](data/stage4-deployed-timings.json) records 2,495 minutes since that latest observed request, a 200 first `/healthz` response in **22,443 ms**, an immediate 200 warm `/healthz` response in **73 ms**, and a 200 `/readyz` response in **936 ms**. These are single deployed observations, not a latency distribution or a performance improvement claim. They are separate from Stage 2 local replay throughput.

**Gate commands:** `node --import tsx tools/fault-fixtures/stage4-gate.ts` exited 0 and saved [stage4-gate.json](data/stage4-gate.json) with ten true checks for frozen evaluation, backend-only figures, fault diagnosis, Data API denial, deployed API/site/authorization/model paths, audited subset, artifact exclusion, Free plan and green CI, and separate cold/warm timing. `CI=true npm run verify` exited 0 against the preserved original local PostgreSQL volume; [stage4-verify-final.txt](data/stage4-verify-final.txt) records lint, strict type checks, private-role check, 29 Vitest tests, benchmark guard, builds, and two Playwright flows. The first 2026-10-30 verify attempt failed with `ECONNREFUSED 127.0.0.1:5432` because Docker Desktop was stopped. After starting Docker, Compose initially used a new empty volume under the renamed AquaLedger directory; that container was stopped without deleting its volume, and `docker compose -p smart-water-sub-meter-platform --env-file .env.backup-before-hosted-samples up -d --wait` restored the original healthy volume before the passing rerun. The final documentation/evidence follow-up commit does not alter the deployed runtime; `fbe71f3` remains the release commit.

**Remaining issue:** Q-05 is a publisher unit-label discrepancy, non-blocking for the historical event demo and explicitly blocking any coverage-certified HSB billing claim. No real customer savings, certified source bills, or production traffic is claimed. Before any future schema correction, keep a private logical export and use a new migration; preserve the published fictional statement revisions.
