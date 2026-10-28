-- Fictional billing is isolated from HSB source_events; no foreign key joins the two.
CREATE TABLE app.societies (
  id text PRIMARY KEY,
  timezone text NOT NULL,
  fixture_id text NOT NULL UNIQUE CHECK (fixture_id = 'billing-demo-v1')
);
CREATE TABLE app.flats (
  society_id text NOT NULL REFERENCES app.societies(id),
  id text NOT NULL,
  PRIMARY KEY (society_id, id)
);
CREATE TABLE app.profiles (
  auth_user_id uuid PRIMARY KEY,
  society_id text NOT NULL REFERENCES app.societies(id),
  role text NOT NULL CHECK (role IN ('manager', 'resident')),
  flat_id text,
  FOREIGN KEY (society_id, flat_id) REFERENCES app.flats(society_id, id),
  CHECK ((role = 'manager' AND flat_id IS NULL) OR (role = 'resident' AND flat_id IS NOT NULL))
);
CREATE TABLE app.billing_periods (
  id uuid PRIMARY KEY,
  society_id text NOT NULL REFERENCES app.societies(id),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  currency text NOT NULL CHECK (currency = 'INR'),
  invoice_volume_ml bigint CHECK (invoice_volume_ml >= 0),
  variable_minor bigint NOT NULL CHECK (variable_minor >= 0),
  fixed_minor bigint NOT NULL CHECK (fixed_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  bill_version integer NOT NULL DEFAULT 1 CHECK (bill_version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  fixture_id text NOT NULL CHECK (fixture_id = 'billing-demo-v1'),
  invoice_provenance text NOT NULL CHECK (invoice_provenance = 'illustrative_invoice'),
  CHECK (period_end > period_start),
  CHECK (variable_minor + fixed_minor = total_minor)
);
CREATE TABLE app.billing_revisions (
  id uuid PRIMARY KEY,
  period_id uuid NOT NULL REFERENCES app.billing_periods(id),
  revision_number integer NOT NULL CHECK (revision_number > 0),
  preview_hash text NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  bill_version integer NOT NULL,
  input_cutoff timestamptz NOT NULL,
  invoice_snapshot jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, revision_number)
);
CREATE TABLE app.statements (
  id uuid PRIMARY KEY,
  revision_id uuid NOT NULL REFERENCES app.billing_revisions(id),
  flat_id text NOT NULL,
  volume_ml bigint NOT NULL CHECK (volume_ml >= 0),
  variable_minor bigint NOT NULL CHECK (variable_minor >= 0),
  shared_minor bigint NOT NULL CHECK (shared_minor >= 0),
  fixed_minor bigint NOT NULL CHECK (fixed_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  snapshot jsonb NOT NULL,
  UNIQUE (revision_id, flat_id),
  CHECK (variable_minor + shared_minor + fixed_minor = total_minor)
);
CREATE TABLE app.statement_lines (
  statement_id uuid NOT NULL REFERENCES app.statements(id),
  kind text NOT NULL CHECK (kind IN ('variable', 'shared', 'fixed')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  PRIMARY KEY (statement_id, kind)
);
CREATE TABLE app.billing_idempotency (
  society_id text NOT NULL REFERENCES app.societies(id),
  operation text NOT NULL CHECK (operation IN ('publish', 'revision')),
  key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL,
  PRIMARY KEY (society_id, operation, key)
);
CREATE TABLE app.audit_events (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  period_id uuid NOT NULL REFERENCES app.billing_periods(id),
  revision_id uuid REFERENCES app.billing_revisions(id),
  action text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX statements_revision_flat_idx ON app.statements(revision_id, flat_id);
CREATE INDEX revisions_period_number_idx ON app.billing_revisions(period_id, revision_number DESC);
GRANT SELECT ON app.societies, app.flats, app.profiles, app.billing_revisions, app.statements, app.statement_lines, app.audit_events TO app_rw;
GRANT SELECT, INSERT, UPDATE ON app.billing_periods TO app_rw;
GRANT SELECT, INSERT ON app.billing_revisions, app.statements, app.statement_lines, app.audit_events, app.billing_idempotency TO app_rw;
