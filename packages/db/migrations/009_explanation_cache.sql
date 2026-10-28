-- Cache only validated model selections for immutable published statements.
CREATE TABLE app.explanation_cache (
  statement_id uuid NOT NULL REFERENCES app.statements(id),
  revision_id uuid NOT NULL REFERENCES app.billing_revisions(id),
  model text NOT NULL,
  prompt_version text NOT NULL,
  facts_hash text NOT NULL CHECK (facts_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL,
  prompt_tokens integer CHECK (prompt_tokens >= 0),
  completion_tokens integer CHECK (completion_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (statement_id, revision_id, model, prompt_version, facts_hash)
);
REVOKE ALL ON app.explanation_cache FROM app_rw;
GRANT SELECT, INSERT ON app.explanation_cache TO app_rw;
