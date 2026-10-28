# Stage 3 fictional billing API

The billing walkthrough reads only `tools/fault-fixtures/billing-demo.json`, a server-held, complete fictional fixture. HSB events are served separately at `GET /api/v1/source-events/summary` as historical event analytics with an explicit no-billing-coverage flag. Neither route joins HSB rows to bills.

All billing routes require `Authorization: Bearer <Supabase asymmetric access JWT>`. Express verifies signature, issuer, audience, expiry, and UUID subject using `jose`, then loads society, role, and flat from private `app.profiles`. Local integration and browser tests sign ES256 tokens and use the same verification route. The API does not accept a client society or flat as authorization input.

Manager routes:

| Route | Request | Result |
|---|---|---|
| `POST /api/v1/billing-periods` | `periodStartLocal`, `periodEndLocal`, `currency: "INR"`, `invoiceVolumeMl` decimal string or null, `variableMinor`, `fixedMinor`, `totalMinor` decimal strings | Creates fictional draft; 201. An existing active period for the same society and exact `[start,end)` window returns 409 `billing_period_exists` with its `periodId` and status, including concurrent requests. |
| `PUT /api/v1/billing-periods/:id` | Same body | Edits current draft and increments bill version |
| `POST /api/v1/billing-periods/:id/preview` | `{}` | Read-only hash and statement calculations |
| `POST /api/v1/billing-periods/:id/publish` | `{ "previewHash": "<64 hex>" }` plus `Idempotency-Key` | Atomically publishes immutable statement revision; stale hash 409 |
| `POST /api/v1/billing-periods/:id/revisions` | `{}` plus `Idempotency-Key` | Creates a draft from the latest published period; prior revisions stay readable |
| `GET /api/v1/billing-periods` | — | Latest 20 active periods for the manager's society, including the current draft for UI resume after refresh |

Resident routes: `GET /api/v1/me/statements` lists latest published statements for active periods in the verified resident flat. `GET /api/v1/me/statements/:periodId` returns the latest statement; `?revision=1` reads an earlier published revision, including a historical duplicate period retained for audit. Such a detail response includes `supersededByPeriodId` when the period is audit-only. `GET /api/v1/me` returns the verified application's role, society, and flat for UI routing. Cross-flat and cross-society reads return 404.

Stage 4 adds `GET /api/v1/me/statements/:periodId/explanation` with optional positive integer `?revision=`. It uses the same verified resident identity and flat filter as statement detail; unauthorized or cross-flat requests cannot reach Groq. The response includes a backend-rendered `primaryReason`, `summary`, current and optional prior total in decimal-string paise, `source` (`groq`, `cache`, or `fallback`), a bounded fallback category, and fictional fixture/invoice provenance. Groq returns strict structured reason/fact selection only. The backend rejects unsupported references, wrong reason codes, and numeric model prose, then displays its own deterministic text and numbers. A missing key, timeout, 429, invalid output, or per-resident/global request limit yields a deterministic fallback. Valid model selections are cached by statement ID, revision ID, model, prompt version, and facts hash. No billing transaction spans a model call.

The fixture period is exactly `2026-01-01T00:00:00+05:30` to `2026-01-01T01:00:00+05:30`. Its two flat IDs must match the society's configured flats. The example illustrative invoice is 5,000 mL, 500 paise variable and 200 paise fixed, totaling 700 paise. All volumes and amounts in JSON are decimal strings. Every statement and billing response labels fictional-fixture and illustrative-invoice provenance. The shared charge is zero because this fixture declares no shared bucket or physical main meter. Invalid fixture coverage, local-time boundaries, invoice components or volume, and positive variable charge with zero allocatable volume block publication.

The period row lock, recomputation, revision/statements/lines/audit inserts, and idempotency response share one PostgreSQL transaction. Identical idempotency retries return the stored response; a reused key with different input returns 409. See [architecture](ARCHITECTURE_DESIGN.md) and [Stage 3 gate](PROGRESS.md).

Migration 008 enforces one **active** billing period for each society and exact UTC `[period_start,period_end)` pair. The fictional API admits only its fixed Asia/Kolkata fixture window, so a partially overlapping distinct window cannot be created through this API. A different society may use the same window. Pre-existing duplicate periods are retained with their original IDs, revisions, statements, and audit events; later duplicates have `superseded_by_period_id` set to the earliest published period and are audit-only. The limited runtime role cannot set this marker to bypass the unique index. Manager list and normal resident list omit audit-only duplicates; their historical statement details remain readable by period ID. Preview, publish, and new revisions on an audit-only period return 409 `superseded_billing_period`.
