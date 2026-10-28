# Decision 001 — HSB rows are events; billing uses a separate fixture

**Date:** 2026-10-28. **Status:** Accepted for Stage 1.

The pinned HSB 1.1.0 CSV records positive timestamped events after zero filtering. It lacks closed interval boundaries and a meter status or zero-use heartbeat. Sensor/timestamp repeats occur. Therefore the first import table stores `source_events`, with archive-scoped physical line keys, UTC event time, millilitres, and provenance. A future `interval_readings` table for genuinely interval-based feeds is outside Stage 2; HSB rows will not be relabeled as intervals.

No common source billing period is certified. Historical source event analytics and the Stage 3 illustrative test-fixture billing walkthrough remain separate. The importer records the aggregate-supported m³ interpretation of `value` while the publisher's contradictory litre label stays visible in the audit and manifest. This decision resolves A-02, A-03 and A-04 in the architecture design. The v4 plan was updated after Stage 1 to require **10,000 replayed historical source events** through an authenticated event batch API. A distinct interval contract may be added for feeds that truly supply interval boundaries.
