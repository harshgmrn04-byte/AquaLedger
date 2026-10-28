-- HSB rows are events, not proven closed 10-minute intervals.
CREATE TABLE app.source_manifests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doi text NOT NULL,
  dataset_version text NOT NULL,
  archive_sha256 text NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  archive_md5 text NOT NULL CHECK (archive_md5 ~ '^[0-9a-f]{32}$'),
  licence text NOT NULL,
  adapter_version text NOT NULL,
  source_unit_assumption text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doi, archive_sha256, adapter_version)
);
CREATE TABLE app.source_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_manifest_id bigint NOT NULL REFERENCES app.source_manifests(id),
  source_row_key text NOT NULL,
  source_sensor_id text NOT NULL,
  apartment text,
  fixture text NOT NULL,
  channel text NOT NULL,
  event_at timestamptz NOT NULL,
  volume_ml bigint NOT NULL CHECK (volume_ml > 0),
  row_sha256 text NOT NULL CHECK (row_sha256 ~ '^[0-9a-f]{64}$'),
  provenance text NOT NULL DEFAULT 'observed_source_measurement' CHECK (provenance = 'observed_source_measurement'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_manifest_id, source_row_key)
);
CREATE INDEX source_events_sensor_time_idx ON app.source_events(source_sensor_id, event_at);
CREATE TABLE app.import_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_manifest_id bigint NOT NULL REFERENCES app.source_manifests(id),
  subset_limit integer NOT NULL CHECK (subset_limit > 0),
  accepted_count integer NOT NULL CHECK (accepted_count >= 0),
  duplicate_count integer NOT NULL CHECK (duplicate_count >= 0),
  rejected_count integer NOT NULL CHECK (rejected_count >= 0),
  reasons jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON app.source_manifests, app.source_events, app.import_runs TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrate IN SCHEMA app GRANT SELECT, INSERT, UPDATE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrate IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO app_rw;
