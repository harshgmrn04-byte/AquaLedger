-- Retain all pre-existing published periods, revisions, statements, and audit events.
-- A historical duplicate becomes audit-only; the earliest published period owns the active window.
ALTER TABLE app.billing_periods ADD COLUMN superseded_by_period_id uuid REFERENCES app.billing_periods(id);
ALTER TABLE app.billing_periods ADD CONSTRAINT billing_periods_not_self_superseded
  CHECK (superseded_by_period_id IS NULL OR superseded_by_period_id <> id);

WITH first_publication AS (
  SELECT period_id, min(published_at) AS first_published
  FROM app.billing_revisions GROUP BY period_id
), ranked AS (
  SELECT p.id,
    first_value(p.id) OVER w AS canonical_id,
    row_number() OVER w AS position
  FROM app.billing_periods p
  LEFT JOIN first_publication f ON f.period_id=p.id
  WINDOW w AS (PARTITION BY p.society_id,p.period_start,p.period_end
    ORDER BY (f.first_published IS NULL),f.first_published,p.id)
)
UPDATE app.billing_periods p
SET superseded_by_period_id=r.canonical_id
FROM ranked r WHERE p.id=r.id AND r.position>1;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM app.billing_periods WHERE superseded_by_period_id IS NULL
    GROUP BY society_id,period_start,period_end HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'active billing-period duplicates remain'; END IF;
END $$;
CREATE UNIQUE INDEX billing_periods_one_active_window_idx
  ON app.billing_periods(society_id,period_start,period_end)
  WHERE superseded_by_period_id IS NULL;

-- app_rw can create/edit active periods, but cannot mark a new row audit-only to bypass the index.
REVOKE ALL ON app.billing_periods FROM app_rw;
GRANT SELECT ON app.billing_periods TO app_rw;
GRANT INSERT(id,society_id,period_start,period_end,currency,invoice_volume_ml,
  variable_minor,fixed_minor,total_minor,fixture_id,invoice_provenance)
  ON app.billing_periods TO app_rw;
GRANT UPDATE(period_start,period_end,currency,invoice_volume_ml,variable_minor,
  fixed_minor,total_minor,bill_version,status)
  ON app.billing_periods TO app_rw;
