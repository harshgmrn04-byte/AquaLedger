# Smart Water Metering Platform

**Stage 4 deployed smoke passed; cold-start timing and final release review remain.** Stage 3 source-event analytics, separate fictional billing, and minimal manager/resident UI passed their local gate. Migration 008 enforces one active exact billing window per society and preserves historical duplicate revisions for audit. Stage 4 adds a resident-authorized explanation endpoint with strict Groq response validation, revision-aware cache, deterministic fallback, request limits, and a local fault drill. The [HSB source audit](docs/data/HSB_AUDIT.md) finds historical consumption events, not coverage-certified billing intervals. The [billing API](docs/API_BILLING.md) uses only a fictional complete fixture and illustrative invoice. See the [results](RESULTS.md), [runbook](docs/RUNBOOK.md), and [progress review](docs/PROGRESS.md).

The Free demo is at [React site](https://aqualedger-demo.onrender.com) and [API health](https://aqualedger-api.onrender.com/healthz). Cloud deployment follows [the deployment plan](docs/DEPLOYMENT_PLAN.md). Supabase Free and Groq Free account capabilities were tested with real fictional Auth users, limited hosted database roles, and strict model output. Render deployed the green [GitHub Actions commit](https://github.com/harshgmrn04-byte/AquaLedger/actions/runs/40619499702); manager/resident browser, API, revision, cache/fallback, and Data API denial smoke checks passed. Cold-start timing and final release review are tracked in [progress](docs/PROGRESS.md).

The server keeps entry-point wiring in `apps/server/src/ingest.ts` and separates billing allocation/API code from HSB source-event routes. The web app renders HSB historical event analytics and a separate, labeled fictional billing walkthrough. Billing never queries `app.source_events`.

## Run locally with npm

Use Node 24–26, npm 11.20.0, and Docker Desktop. The verified `HSB_Living_Lab_Data_Package.zip` may stay in the project root; it is ignored by Git and Docker. Extract its CSV into ignored `data/raw/` with `mkdir -p data/raw && unzip -p HSB_Living_Lab_Data_Package.zip HSB_Living_Lab_Water_Consumption_Anonymized.csv > data/raw/HSB_Living_Lab_Water_Consumption_Anonymized.csv`. Copy `.env.example` to `.env`; replace the three database-password placeholders and ingestion credential with distinct private values. Set `HSB_CSV_PATH` to the absolute path of the extracted CSV. For a quick local start, the checked-in audited 1,000-row prefix at `tools/import-hsb/fixtures/hsb-sample-1000.csv` also works; only those rows can then be submitted to the API.

```sh
npm ci
docker compose up -d --wait
npm run db:setup
npm run db:migrate
npm run db:check
npm run billing:seed
```

Seed the fictional local billing profiles, then set `AUTH_ISSUER`, `AUTH_JWKS_URL`, and `AUTH_AUDIENCE` in `.env` to an asymmetric Supabase Auth project. The local seed uses fixed fictional UUIDs for tests; manual Supabase sign-in requires inserting the actual Auth user UUIDs into `app.profiles` with migration credentials. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the React sign-in form. Start the API and web app in separate terminals:

```sh
npm run start:api
```

```sh
npm run dev:web
```

Open `http://127.0.0.1:5173`. The API runs at `http://127.0.0.1:3001`; `/healthz` is a shallow check and `/readyz` checks PostgreSQL. The source summary endpoint displays only actually imported rows. The authenticated batch endpoint is documented in [API_SOURCE_EVENTS.md](docs/API_SOURCE_EVENTS.md). The two Playwright flows use a separate local Auth fixture server with locally signed tokens and do not need a Supabase account.

Run all local checks with `CI=true npm run verify`. It needs the isolated benchmark database for the API integration tests:

```sh
node --import tsx tools/bench/prepare.ts
POSTGRES_DB=water_metering_bench npm run db:setup
POSTGRES_DB=water_metering_bench npm run db:migrate
CI=true npm run verify
node --import tsx tools/fault-fixtures/evaluate-explanations.ts
node --import tsx tools/fault-fixtures/stage4-drill.ts
```

Verification seeds and clears billing rows only in `water_metering_bench`; it leaves published statements in the main local database untouched. On Linux CI, the workflow installs Playwright Chromium. On macOS, Playwright uses an installed Google Chrome; if it is absent, install Chromium with `npx playwright install chromium`.

The explanation case set at `tools/fault-fixtures/explanation-cases-v1.json` contains 32 frozen fictional cases. The saved `tools/bench/results/stage4-explanations-v4.json` records 32/32 primary-reason agreement and 32/32 validated Groq outputs on this account, with raw response and latency per case. The drill writes sanitized request-ID evidence for a local database outage, 429/timeout fallback, duplicate historical-event replay, and stale fictional preview. Neither result is a deployed observation. The React page has a labeled static source-audit snapshot during API failure; it is not a live statement.

For Supabase, use the session-pooler host, project-qualified `POSTGRES_USER=app_rw.<project-ref>` and `POSTGRES_MIGRATE_USER=app_migrate.<project-ref>`, `POSTGRES_DB=postgres`, and `POSTGRES_SSL=require`; optionally set `POSTGRES_CA_PATH` for certificate verification. Obtain a private backup before hosted schema changes. Run the opt-in `HOSTED_SUPABASE=true npm run db:hosted-prepare` only with the separate owner credential, then `npm run db:migrate` and `npm run db:check` with migration/runtime credentials. Never run local `db:setup` against Supabase. With a temporary server-only `SUPABASE_SECRET_KEY` in ignored `.env`, `node --import tsx tools/fault-fixtures/create-hosted-auth-users.ts` creates three fictional Auth users and records their login credentials and UUIDs locally; `npm run billing:seed-hosted` maps their returned UUIDs. Import only the checksum-verified 1,000-row prefix with `HOSTED_SUPABASE=true`. This hosted path has passed the account test; the Data API denied both anonymous and resident access to `app` tables. Keep passwords, the Auth secret key, and `GROQ_API_KEY` server-side.

The importer accepts only the audited full CSV or exact 1,000-row prefix and verifies its SHA-256 and the ZIP digest. For a local import, run `npm run hsb:import -- --archive HSB_Living_Lab_Data_Package.zip --csv tools/import-hsb/fixtures/hsb-sample-1000.csv --limit 1000 --out docs/data/hsb-import-small.json`. Repeating the same import reports duplicates. `docs/data/hsb-profile.json` and the small CSV are checked-in source-derived artifacts under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); cite Knutsson, [DOI 10.5281/zenodo.22076411](https://doi.org/10.5281/zenodo.22076411), when reusing them. See [benchmark reproduction](tools/bench/README.md), [progress](docs/PROGRESS.md), and [questions](docs/QUESTIONS.md).
