# Smart Water Metering Platform — Current Questions

**Updated:** 2026-10-28
**Scope:** v4 only. Superseded v2 questions are preserved in docs/archive/QUESTIONS_v2_2026-10-27.md.

Record a question only when evidence is missing or a phase gate is blocked. Each entry must name the next check and owner. Resolve findings in this file or a decision record; do not silently treat a guess as a fact.

| ID | Question | Next action | Owner / due phase | Status |
|---|---|---|---|---|
| Q-01 | What are the actual HSB fields and semantics? | Resolved in `docs/data/HSB_AUDIT.md`: 16 fields, UTC positive events, stable sensor tuple, archive-scoped CSV line identity. | Coding agent / Stage 1 | Resolved |
| Q-02 | Is any common measured billing window coverage-valid? | Resolved: no. Zero rows are removed and no heartbeat/status mask exists; 0 certified apartments/periods. Separate illustrative billing fixture accepted in decision 001. | Coding agent / Stage 1 | Resolved |
| Q-03 | What licence and checksum apply? | Resolved: CC BY 4.0 on Zenodo and in archive; Zenodo MD5 and local SHA-256 match audit/manifest. Actual version label is 1.1.0. | Coding agent / Stage 1 | Resolved |
| Q-04 | Can this account deploy the full demo at ₹0 on Render Free, Supabase Free, and Groq Free? | Supabase Free session-pooler TLS/custom roles, asymmetric JWKS, Auth users, private-schema/Data API denial, and Groq strict output are account-tested. Render Free service/static-site creation and deployed smoke remain. Obtain Render API access or complete dashboard setup, then verify plan and URLs. | Coding agent and account owner / Stage 4 | Open, Render and deployed gate pending |
| Q-05 | Why does the data dictionary label `value` litres when the full sum and cleaning threshold indicate m³? | Seek publisher clarification or a source code/data release correction before any coverage-certified measured-volume billing claim. Until then, preserve the aggregate-supported m³ inference and caveat in all source analytics. | Publisher clarification / before any certified measured-volume claim | Open, non-blocking for event import |
| Q-06 | Is `row_sha256` meant to identify raw CSV bytes or canonical parsed fields? | Resolved in decision 002: `hsb-parsed-fields-json-v1` specifies all 16 parsed string fields in header order. Adapter 1.0.0 and stored hashes remain unchanged; the original 1,000 rows replayed as duplicates. | Coding agent / Stage 2 | Resolved |
| Q-07 | How will cloud Supabase Auth user UUIDs map to the local fictional manager/resident profiles? | Resolved: three real Auth users with reserved fictional `example.com` addresses were created with the local secret key; their returned UUIDs were mapped to the private society/flat/role profiles. Hosted sign-in and 23 local-API/hosted-database smoke checks passed. Credentials/UUIDs stay in ignored `.env`. | Coding agent / Stage 4 | Resolved |
| Q-08 | How can one billable period per fictional society/window coexist with already-published duplicate rows? | Resolved by forward migration 008: retain every legacy row and child revision/audit record, mark later equal-window periods audit-only, enforce a unique active society/window index, and deny runtime writes to the audit-only marker. See the Stage 3 repair evidence in `PROGRESS.md`. | Coding agent / Stage 3 repair | Resolved locally |

## Stage 4 account capability check — 2026-10-28

Official Supabase, Groq, and Render documentation was rechecked. This account successfully used the Supabase Free session pooler over TLS with project-qualified custom roles, applied migrations 001–009, imported only the checksum-verified HSB 1,000-row prefix, created three fictional Auth users, and served signed JWTs using an asymmetric JWKS key. The private `app` schema returned HTTP 406 to both unauthenticated and authenticated resident Data API probes. Groq's `openai/gpt-oss-20b` strict-output mode accepted 32/32 frozen fictional cases; case-level raw output is preserved. The Render account's ability to create two Free services remains untested, and no deployed URL or green GitHub Actions run has yet been observed. The account owner has been asked to place a Render API key in ignored `.env` for that remaining test. No payment method or paid tier has been used by this work.

No cloud credentials or owner decision is needed for the initial local audit and foundation. If a question becomes a true blocker, state the failed command or source, the safe work completed, and the specific owner decision required.
