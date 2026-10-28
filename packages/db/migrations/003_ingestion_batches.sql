-- Forward-only Stage 2 audit trail. The v1 row_sha256 column retains its
-- parsed-fields JSON hash semantics and existing 1,000 Stage 1 rows.
CREATE TABLE app.source_event_batches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_manifest_id bigint NOT NULL REFERENCES app.source_manifests(id),
  request_id uuid NOT NULL,
  accepted_count integer NOT NULL CHECK (accepted_count >= 0),
  duplicate_count integer NOT NULL CHECK (duplicate_count >= 0),
  conflict_count integer NOT NULL CHECK (conflict_count >= 0),
  rejected_count integer NOT NULL CHECK (rejected_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.source_event_conflicts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_manifest_id bigint NOT NULL REFERENCES app.source_manifests(id),
  source_row_key text NOT NULL,
  existing_row_sha256 text NOT NULL CHECK (existing_row_sha256 ~ '^[0-9a-f]{64}$'),
  incoming_row_sha256 text NOT NULL CHECK (incoming_row_sha256 ~ '^[0-9a-f]{64}$'),
  batch_id bigint NOT NULL REFERENCES app.source_event_batches(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_event_conflicts_key_idx ON app.source_event_conflicts(source_manifest_id, source_row_key);
GRANT SELECT, INSERT ON app.source_event_batches, app.source_event_conflicts TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_rw;
