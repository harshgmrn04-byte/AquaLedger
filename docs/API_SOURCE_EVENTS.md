# Stage 2 source-event batch API

`POST /api/v1/source-events/batches` requires `Authorization: Bearer <INGESTION_CREDENTIAL>`. The credential is configured only on the server and is unrelated to resident/manager sign-in. The server must be configured with the audited CSV path and profile path. `GET /healthz` is shallow; `GET /readyz` checks PostgreSQL.

Request JSON has exactly `sourceManifestId` (a decimal ID string for the pinned HSB 1.1.0 archive and adapter) and `events` (1–500 items). Each item has exactly `csvLine` (integer physical CSV line, starting at 2) and `fields` (all 16 string-valued source CSV columns as named in `docs/data/HSB_AUDIT.md`). Do not send a hash, volume, or provenance assertion. JSON body limit is 1 MiB.

The 200 response contains `requestId`, durable `batchId`, `hashContract`, aggregate `counts`, and an `outcomes` entry for every input index in input order. Statuses are `accepted`, `duplicate`, `conflict`, or `rejected`. Stable reason codes: `inserted`, `same_canonical_row`, `changed_source_row_key`, `invalid_event_shape`, `invalid_source_fields`, `invalid_source_field`, `invalid_utc_timestamp`, `non_positive_volume`, `sensor_mapping_mismatch`, `archive_row_mismatch`. Invalid batch envelope returns 400; oversized body returns 413; missing/wrong credential returns 401; unapproved manifest returns 400. A database transaction failure returns 503 and writes nothing from that batch. Each 200 response is sent after commit.

`row_sha256` and event provenance are derived on the server. `volume_ml` remains an integer in PostgreSQL and is never returned as a JSON number. Accepted rows are published historical source-event replays, not coverage-certified billing readings. See [decision 002](decisions/002-stage2-hash-and-http-ingestion.md).
