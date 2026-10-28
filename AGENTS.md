# Smart Water Metering Platform

## Source of truth

`WATER_METERING_BUILD_PLAN_v4.md` defines the first release. Superseded v2/v3 plans are archived in `docs/archive/` and must not drive implementation. Read `docs/PROGRESS.md`, `docs/ARCHITECTURE_DESIGN.md`, and `docs/QUESTIONS.md` at the start of each coding chat. The published HSB dataset supplies real historical measurements; invoices are illustrative unless a real matching invoice is provided. Never present an injected test fixture as observed water use.

## Working rules

1. Stages 1, 2, and 3 passed their local gates. Build Stage 4 next, and pass its release gate before claiming the project is complete.
2. Keep the first release focused on versioned HSB source-event ingestion/analytics and a **separate fictional-fixture** billing walkthrough, resident statements, Groq bill explanations, CI, observable failure handling, and a small React demo. The HSB event file has no coverage-certified billing period. MQTT, Redis, queues, partitioning, and full multi-society administration are deferred.
3. Read current official documentation before using provider or library APIs. Pin dependency versions during bootstrap.
4. Use strict TypeScript. Validate API, dataset-adapter, environment, and Groq boundaries with Zod. Keep business calculations in testable functions.
5. Store money as integer minor units and volume as integer millilitres. Encode both as decimal strings in JSON. Store timestamps in UTC and interpret period boundaries in the society timezone.
6. Keep secrets and real personal data out of Git. Never log keys or database credentials. The Groq key and database password belong only on the server.
7. Record a reproducible baseline before optimizing a benchmarked path. Do not invent or hand-edit resume metrics. Separate observed measurements, replayed historical imports, injected fault tests, and illustrative invoice/counterfactual allocation results. Resume bullets must connect what was engineered, how it worked, a measured before/after or absolute result, and the user or business consequence; every number must trace to a saved result field.
8. Add tests for billing and ingestion invariants, run `npm run verify` before calling work complete, and keep `RESULTS.md` tied to raw benchmark files.
9. Preserve applied migrations and published statement revisions. Use new migrations and revisions for corrections.
10. Keep application tables in a private schema behind Express. Use a limited runtime database role; Supabase Auth handles sign-in but does not grant direct table access. Verify JWT identity and load application authorization from the database.
11. Work one v4 stage per coding chat. Before ending a chat, update `docs/PROGRESS.md` with exact gate status, tests, evidence paths, blockers, and next action. Update `docs/ARCHITECTURE_DESIGN.md` for any changed boundary or decision, and `docs/QUESTIONS.md` for unresolved issues. Do not mark a stage done when its gate fails.

## Repository shape

`apps/server` contains Express and domain modules; `apps/web` contains React; `packages/shared` contains schemas and API types; `packages/db` contains SQL migrations and seeds; `tools/import-hsb`, `tools/fault-fixtures`, and `tools/bench` contain repeatable data and measurements.

## Handoff

The repository uses npm workspaces and a locked `npm ci` install. Stage 1 evidence is in `docs/data/`; Stage 2 has an authenticated **event** batch API and corrected matched HTTP baseline/final evidence in `tools/bench/results/`. Stage 3 has a locally verified fictional billing walkthrough, and migration 008 enforces one active exact billing window per society while preserving historical duplicate revisions. Stage 4 covers Groq, operational drills, cloud release, and resume evidence. Do not relabel HSB rows as intervals or combine them with fictional billing inputs. If a provider limit or documented capability blocks v4, record the finding in `docs/QUESTIONS.md` and resolve that specific decision before building on it. Keep raw benchmark and evaluation outputs for any resume claim.
