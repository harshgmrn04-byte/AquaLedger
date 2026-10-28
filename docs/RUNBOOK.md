# Stage 4 operational runbook

**State on 2026-10-28:** the local fault drill and deployed API/React smoke passed on [Free API](https://aqualedger-api.onrender.com) and [static site](https://aqualedger-demo.onrender.com). Evidence: [`stage4-fault-drill.json`](data/stage4-fault-drill.json), [deployed API smoke](data/stage4-deployed-api-smoke.json), [browser smoke](data/stage4-deployed-web-smoke.json), [model/cache/fallback smoke](data/stage4-deployed-model-smoke.json), [bounded Render logs](data/stage4-render-log-evidence.json), [hosted HSB import](data/stage4-hosted-hsb-import.json), and [replay](data/stage4-hosted-hsb-replay.json). The database outage and Groq 429/timeout in the drill were injected locally. Its duplicate replay used a published HSB historical event from the verified 1,000-row subset; its billing preview used only the fictional fixture.

## First checks

1. Copy the `X-Request-Id` response header and search the API's JSON logs for that exact request ID. The log contains route, status, duration, source batch ID, billing revision ID, and failure category. It must not contain tokens, database credentials, resident volume, or model prompts.
2. Check `/healthz` for process availability and `/readyz` for PostgreSQL. A 200 health response with 503 readiness narrows the fault to the database path; both unavailable can mean Render is waking or the service failed to start.
3. Check the Render service deployment and logs, Supabase project status and connection limits, and Groq usage/rate limits. Keep cold wake-up timing separate from warm requests.
4. If the React site reports `Failed to fetch` after an origin change, check `WEB_ORIGIN` on the API against the site's exact HTTPS origin and verify a live response contains `Access-Control-Allow-Origin`. Render saved the correct value during this release but required a deploy-only restart of the existing build before the process used it. Do not add a wildcard CORS origin.

## Database unavailable

**Symptom:** `/healthz` 200, `/readyz` 503 `database_unavailable`; protected routes return a controlled 503. **Signal:** request log `failureCategory=database_unavailable` on readiness, with a request ID. **Likely causes:** paused Supabase Free project, wrong session-pooler host or project-qualified username, SSL mismatch, exhausted connections, or a database outage. **Recovery:** resume the project in Supabase if paused; verify the host, port 5432, database `postgres`, project-qualified `app_rw.<project-ref>`, TLS setting, and pool size; check credentials privately. Restart the Render service only after the connection path is sound. Do not paste passwords into logs or tickets. Readiness must return 200 before write routes are used.

## Groq timeout or 429

**Symptom:** resident explanation returns 200 with `source=fallback` and `fallbackReason=timeout` or `rate_limited`; billing and statement reads remain available. **Signal:** request-ID log `groq_timeout` or `groq_rate_limited`. **Recovery:** check Groq's account-specific model access and rate dashboard, then wait for the documented limit window or correct the server-only key. The endpoint makes at most two attempts, has a 3.5-second timeout per attempt, limits new model requests per process to five per minute and two per resident per minute, and caches validated results by statement revision and facts hash. Do not turn off the fallback to force a model call. A missing key uses a deterministic explanation.

## Duplicate HSB event replay

**Symptom:** an authenticated batch returns `duplicate` counts and `same_canonical_row`. **Signal:** request-ID batch log contains the batch ID and counts. **Recovery:** compare the source manifest DOI, archive checksum, adapter version, and physical CSV line key. An identical replay is safe and adds no new event. A changed key produces a durable conflict for review; never overwrite the observed source row. Do not use these event sums as certified billing volume.

## Stale billing preview

**Symptom:** publication returns 409 `stale_preview` after the draft changes. **Signal:** request-ID log `failureCategory=stale_preview`. **Recovery:** request a new preview from the latest draft, review its fictional invoice and exact statement reconciliation, and publish using its new hash and a new idempotency key. A retry with the same key and body returns the original result. Do not modify a published revision; create a new draft revision.

## Free deployment and recovery

Render Free may spin down the web service when idle; a cold request can take longer. The React static page keeps an explicitly labeled source-audit snapshot for an unavailable API. It is not a live statement. Supabase Free may pause after inactivity. Before each hosted schema change, keep a private logical export; Supabase Free does not supply managed automatic backups. Use controlled `db:hosted-prepare` once, then `db:migrate` with the separate migration credential, and check grants with `db:check`. This path succeeded on the hosted project with migrations 001–009. Never run local `db:setup` against Supabase. Keep the full HSB CSV and ZIP off Render and Git; import only the checksum-verified 1,000-row subset through a controlled job. The public site uses Express for all application data and Supabase Auth only for sign-in. Both anonymous and resident Data API probes returned HTTP 406 for `app.societies`; repeat this after each exposure-setting change. The fictional demo's three Auth users and login secrets live only in ignored `.env`; do not put the secret Admin key in Render or Vite configuration.
