# Deployment plan — portfolio release

**Prepared:** 2026-10-28  
**Status:** Stage 4 release gate passed for deployed commit `fbe71f3`; [raw gate evidence](data/stage4-gate.json) records the account and deployed checks.
**Target:** A public, read-only portfolio demo at ₹0 using Render Free for Express and React, Supabase Free for PostgreSQL and Auth, and Groq Free for explanations. A manager login may exercise the fictional billing walkthrough, but public visitors cannot mutate data.

This is the executable Stage 4 handoff for [v4](../WATER_METERING_BUILD_PLAN_v4.md). Recheck provider capabilities and account-specific limits at deployment; resolve Q-04 in [QUESTIONS.md](QUESTIONS.md) with actual test results. Do not interpret a local test or a published free-tier page as proof that this account's cloud setup works.

## What runs where

| Component | Target | Data and exposure |
|---|---|---|
| React site | Render Static Site, free | Built assets only. Public configuration may include the API URL, Supabase project URL, and publishable key. No database password, ingestion credential, or Groq key. |
| Express API | Render Web Service, free Docker runtime | Owns application authorization, billing, Groq calls, and database queries. Exposes `/healthz`, `/readyz`, and approved API routes over HTTPS. |
| PostgreSQL and sign-in | Supabase Free project | Private `app` schema, limited runtime role, separate migration role, Supabase Auth with asymmetric JWT signing. The Data API must not expose application tables. |
| AI | Groq Free API | Server-side key only; model output validated and cached by statement revision. Public traffic cannot trigger unbounded paid or rate-limited calls. |
| Source archive | Local, checksum-verified ZIP | Full HSB archive stays outside Git and Render; use it for local audit and benchmarks. The deployed API carries only the checked-in, audited 1,000-row CSV prefix and sensor profile for a small historical demo. |

The HSB source-event view and the fictional billing walkthrough remain separate. The hosted seed is a **subset of published historical events**, not live telemetry or certified billable consumption. The illustrative invoice and fixture statements must be labeled on every public screen.

## Before creating cloud services

1. Finish the Stage 3 gate: role-scoped manager/resident flows, exact billing reconciliation, immutable revisions, Playwright paths, and local tests. Finish the Stage 4 Groq evaluation and deterministic fallback before enabling public model calls.
2. Create the first Git commit and push the repository without `.env`, the root HSB ZIP, or `data/raw/`. Confirm an actual green GitHub Actions run for that commit. The existing workflow file alone is not a passed CI run.
3. In Q-04, confirm this account can create a Render Free web service and static site, a Supabase Free project with asymmetric Auth signing and session-pooler access, and a Groq Free key for the selected strict-output model. Record the exact date, feature test, and outcome. Do not add a payment method or select a paid tier to satisfy this plan.
4. Choose nearby Render and Supabase regions where possible. Keep the hosted HSB subset and fictional demo data small enough for Supabase Free; retain full-archive benchmarks locally. Check the current provider dashboards for usage and limits before exposing the demo.

## Database and Auth setup

1. Create one Supabase Free project. Configure an **asymmetric** Auth signing key, inspect the project JWKS, and create fictional manager and resident demo users. Store their application society/flat/role in `app.profiles`; JWT identity alone does not grant an application role.
2. Use the account-tested hosted path in [`packages/db/src/config.ts`](../packages/db/src/config.ts) and [`apps/server/src/config/database.ts`](../apps/server/src/config/database.ts). The session pooler requires project-qualified usernames such as `app_rw.<project-ref>`; the runtime uses a small `pg` pool and TLS. `db:hosted-prepare` created only the private `app` schema and limited roles under Supabase managed privileges; `db:setup` remains local-only and must never be run against the managed project.
3. Keep `app` non-exposed and the runtime role limited to required tables. Disable the generated Data API if the Auth-only frontend works with it disabled. Verify that a public or authenticated Data API request cannot read `app` tables. The React app reads application data through Express only.
4. Run forward-only migrations from a controlled local or CI job with the migration credential; do not run migrations at API startup. Save migration version and grant-check output. Seed the pinned HSB 1,000-row subset and a **separate fictional** billing fixture once through controlled tooling. Record source manifest, checksum, counts, and replay result. Keep the source ZIP and full CSV off Render and out of Git.

Supabase documents the shared **session pooler** for persistent backends on IPv4-only networks and its project-qualified custom-role usernames. It recommends SSL for database connections. See [connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres), [Data API security](https://supabase.com/docs/guides/api/securing-your-api), and [JWT/JWKS verification](https://supabase.com/docs/guides/auth/jwts).

## API deployment on Render

1. Create a Render **Web Service** from the verified Git commit. Use the repository root as Docker build context and the existing root `Dockerfile`; choose the Free compute plan. The server must listen on Render's `PORT` and `0.0.0.0`. Set `/healthz` as the shallow health path, then check `/readyz` separately for database access.
2. Configure server-only environment variables in Render: hosted runtime database host/port/name/project-qualified role/password and SSL settings; Supabase issuer, audience, and JWKS URL; exact frontend origin for CORS; `INGESTION_CREDENTIAL`; `HSB_CSV_PATH=tools/import-hsb/fixtures/hsb-sample-1000.csv`; `HSB_PROFILE_PATH=docs/data/hsb-profile.json`; and `GROQ_API_KEY` and model settings. Use the exact names implemented in Stage 3/4 and document them in `.env.example` without values. Never put secrets in `VITE_*` variables or GitHub logs.
3. The current app reads the audited CSV at startup and checks its hash. The checked-in 1,000-row prefix is available in the Docker image. Do not point Render at `data/raw/` or the root ZIP: both are excluded from the image, and the Free filesystem is ephemeral.
4. Keep the server's connection pool small, bound database and Groq timeouts, and preserve request-ID logs. Disable or strictly protect write/ingestion routes for the public demo. On a cold start, distinguish wake-up time from warm API latency; never use Render cold starts to support the local ingestion benchmark claim.

Render documents Free web services, their idle spin-down and ephemeral filesystem, Docker deployment, and port binding: [Free services](https://render.com/docs/free), [web services](https://render.com/docs/web-services).

## React site on Render

1. Create a separate Render **Static Site** from the same verified Git commit. Use repository root, build command `npm ci && npm run build --workspace=@water/shared && npm run build --workspace=@water/web`, and publish directory `apps/web/dist`.
2. At build time, set only public frontend values: the Render API base URL, Supabase project URL, and Supabase **publishable** key under the Vite variable names implemented in Stage 3. The app obtains an Auth token, sends it to Express, and never queries application tables through the Supabase Data API.
3. If React Router uses client-side paths, configure Render's rewrite `/*` to `/index.html`. Add the static-site origin to the API's exact CORS allowlist. Provide a clearly labeled cached static snapshot for Render wake-up or Supabase pause, and ensure it cannot be mistaken for a live statement.

Render's [static-site guide](https://render.com/docs/static-sites), [monorepo settings](https://render.com/docs/monorepo-support), and [rewrite rules](https://render.com/docs/redirects-rewrites) support these settings.

## Release checks and evidence

Run these checks against the deployed URLs, save bounded output in `docs/data/` without tokens or personal data, and record the deployed Git commit:

1. Confirm the GitHub Actions verification run passed for the deployed commit. Test the service on a cold request and a warm request; keep those timings separate.
2. `GET /healthz` returns 200 when the process is up; `GET /readyz` returns 200 only when PostgreSQL is reachable. Verify the React site and direct navigation to manager/resident routes.
3. Sign in as the fictional manager and resident. Check preview/publish, read-only resident statement access, cross-flat denial, and prior revision visibility. Confirm every billing figure comes from the fictional fixture and exact reconciliation.
4. Check the HSB analytics view cites the dataset, version, licence, unit inference, and lack of billing coverage. Confirm the 1,000-row hosted manifest is the verified subset and that the full CSV is absent from the image.
5. Check Groq's strict-output model on this account, fallback on `429`/timeout, cache hits, and that public traffic cannot trigger unbounded model calls. Save the frozen evaluation outputs separately from the deployment smoke results.
6. Attempt a Data API read of `app` tables as an unauthenticated and authenticated test client; both must fail. Review logs for request IDs and failure categories without secrets or resident volume values.
7. Document Render Free wake-up behavior, Supabase Free pause recovery, the Groq fallback, a read-only static snapshot, and how to diagnose database/API outages in the runbook. Do not report hosted throughput as the Stage 2 local benchmark.

The release gate passes only after the deployed demo works, the Data API boundary is tested, a real CI run is green, provider capabilities are confirmed, and every resume metric links to raw evidence. Until then, label the project **locally verified, deployment pending**.

## Free-tier limits and fallback

As checked on 2026-10-28, Render supports Free web services and static sites but spins idle web services down and measures included bandwidth/build usage; Supabase Free may pause after low activity and has a 500 MB database-size allowance; Groq documents Free-tier rate limits for `openai/gpt-oss-20b` and strict structured outputs. These limits can change and are account-specific. Keep a small seed, cache explanations, monitor the dashboards, and use the static snapshot when a dependency is asleep. Supabase Free has no managed automatic backups: keep a private logical export before hosted schema changes, and verify that the demo can be restored or reseeded. Never use synthetic keep-alive traffic to present the service as continuously available. See [Render Free](https://render.com/docs/free), [Supabase Free](https://supabase.com/pricing), [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [backups](https://supabase.com/docs/guides/platform/backups), [Groq limits](https://console.groq.com/docs/rate-limits), and [structured outputs](https://console.groq.com/docs/structured-outputs).
