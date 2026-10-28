-- Migration 001 granted INSERT on future tables; narrow each Stage 3 table explicitly.
REVOKE ALL ON app.societies, app.flats, app.profiles, app.billing_periods,
  app.billing_revisions, app.statements, app.statement_lines,
  app.billing_idempotency, app.audit_events FROM app_rw;
GRANT SELECT ON app.societies, app.flats, app.profiles, app.billing_revisions,
  app.statements, app.statement_lines, app.audit_events TO app_rw;
GRANT SELECT, INSERT, UPDATE ON app.billing_periods TO app_rw;
GRANT SELECT, INSERT ON app.billing_revisions, app.statements, app.statement_lines,
  app.audit_events, app.billing_idempotency TO app_rw;
