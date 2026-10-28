# Open questions

## 2026-10-27 — Before any cloud-dependent task: Free-tier limits
- **What is blocked:** Treating the limits and zero-payment assumptions in section 2 as current facts for Supabase, Render, HiveMQ Cloud, Upstash, Groq, and GitHub.
- **What I tried:** Read the plan's explicit instruction to verify each provider's current pricing page. This review checked technical extension documentation, not every provider's current pricing and terms.
- **Need from the owner:** Nothing yet. Verify official pricing and service limits before relying on each service; if any relevant price or limit has changed, record the evidence here and stop the affected task for an owner decision.

## 2026-10-27 — Week 1, Tasks 2–3: Postgres image and extensions
- **What is blocked:** Choosing a pinned local `supabase/postgres` image that mirrors the hosted project's Postgres major version and supports `pg_partman` and `pg_cron` with the required preload/configuration.
- **What I tried:** Read plan sections 2, 3, and 7.2 and the current [Supabase pg_partman guide](https://supabase.com/docs/guides/database/extensions/pg_partman), [Cron guide](https://supabase.com/docs/guides/cron), and [self-hosted image guidance](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/self-hosting/custom-postgres-extensions.mdx). These establish supported extensions in Supabase, but do not prove that a selected local tag boots with both. No image has been pulled or tested yet.
- **Need from the owner:** The hosted Supabase project's Postgres major version when the project exists. Before Task 2 is accepted, inspect the pinned local image and run `CREATE EXTENSION` plus a maintenance/cron smoke test. If the required extensions are unavailable, agree on an ADR before changing the plan.

## 2026-10-27 — Week 1, Task 4: Interval boundaries and coverage
- **What is blocked:** Exact interval tests for a reading at the bucket end, a counter reset between boundary readings, and `coverage` when sequence numbers skip. Section 7.3 gives the endpoint-difference rule but does not define these cases precisely enough to assert conservation across buckets.
- **What I tried:** Compared the interval rule, reset/gap rules, and Task 4 acceptance criteria in sections 7.3 and Week 1.
- **Need from the owner:** Confirm a precise bucket convention and whether consumption across a sequence gap is counted as observed-but-incomplete, plus the expected coverage formula. A proposed rule can be captured in an ADR before implementation.

## 2026-10-27 — Week 1, Tasks 7–8: B1 stopping threshold and loss accounting
- **What is blocked:** The B1 baseline says to increase offered rate until loss **or latency exceeds a threshold**, but it supplies no latency threshold or measurement window. It also requires zero loss across broker and ingest restarts without defining which messages enter the denominator (published, broker-accepted, or acknowledged).
- **What I tried:** Compared sections 1.1, 8.3–8.5, and Week 1 Tasks 7–8.
- **Need from the owner:** Approve the latency threshold, observation window, and loss denominator before the official B1 baseline. Record them in the scenario and harness; do not choose them after seeing results.

## 2026-10-27 — Week 1, Task 8: MQTT acknowledgment support
- **What is blocked:** Confirming the pinned `mqtt` client and both brokers can implement PUBACK only after the batch transaction commits, including replay after process death.
- **What I tried:** The current [MQTT.js client docs](https://github.com/mqttjs/MQTT.js) call `customHandleAcks` an MQTT 5 feature; [client source](https://github.com/mqttjs/MQTT.js/blob/main/src/lib/client.ts) enables it only when `protocolVersion === 5`. The plan does not specify MQTT protocol version. No version-pinned client or broker integration has been tested yet.
- **Need from the owner:** No credential is needed for the local proof. Before Task 8, pin the client and broker versions, configure MQTT 5 persistent sessions, and prove delayed ACK behavior under a real-broker kill/restart test. If a required broker cannot support it, propose an ADR and stop Task 8.

## 2026-10-27 — Week 1, Tasks 1 and 5: External checkpoints
- **What is blocked:** Task 1 cannot be called done until CI is green; Task 5 cannot be called done until the owner reviews simulator realism.
- **What I tried:** Checked the repository: `origin` is configured, but the checkout has no commits and the two planning files are untracked. No CI run or simulator review exists yet.
- **Need from the owner:** Ensure the GitHub repository permits the planned branch/PR and Actions workflow; review the deterministic simulator output and leak labels at the Task 5 checkpoint. No cloud keys are needed for the initial local scaffolding.
