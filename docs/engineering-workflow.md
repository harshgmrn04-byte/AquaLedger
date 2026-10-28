# Engineering workflow record

| Stage/task | AI-assisted suggestion and human review focus | Verification | Rejected or corrected output |
|---|---|---|---|
| Stage 1 audit and foundation | Generated adapter/schema skeleton reviewed against the actual HSB dictionary, CSV, cleaning script, and live database grants. | Archive hashes, full CSV profile, sample import/replay, Vitest, PostgreSQL grant/constraint checks, build. | Rejected the plan's implied interval-row interpretation and dictionary's uncorroborated litre unit. Replaced `sensor_id + timestamp` identity with archive-scoped file-line keys after 701 collisions were measured. Removed an unnecessary runtime UPDATE grant from future default privileges in migration 002. |

Review again before Stage 2 API work for SQL authorization, credentials, external calls, and failure handling. This document records coding review, not an autonomous agent workflow claim.

| Stage 3 billing and auth | Generated billing/API/UI modules were reviewed against v4, fixture provenance, SQL grants, local JWT verification, transaction locking, and money/volume string encoding. | Pure allocation properties, PostgreSQL authorization/publication integration tests, two Playwright role flows, CI-mode local verify transcript. | Corrected inherited future-table INSERT grants with migration 005, corrected Playwright test Auth preflight headers, and rejected HSB event rows as billing inputs. |
