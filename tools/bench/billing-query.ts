import { mkdirSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import pg from 'pg';

if (existsSync('.env')) loadEnvFile('.env');
const label = process.argv[2];
if (label !== 'before' && label !== 'after') throw new Error('Use before or after');
const db = new pg.Client({ host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432), database: process.env.POSTGRES_DB ?? 'water_metering', user: 'app_rw', password: process.env.APP_RW_PASSWORD });
await db.connect();
try {
  await db.query('BEGIN');
  await db.query(`INSERT INTO app.billing_periods(id,society_id,period_start,period_end,currency,invoice_volume_ml,variable_minor,fixed_minor,total_minor,fixture_id,invoice_provenance)
    SELECT gen_random_uuid(),'fictional-demo',t,t + interval '1 hour','INR',5000,500,200,700,'billing-demo-v1','illustrative_invoice'
    FROM generate_series('2026-01-01T00:00:00Z'::timestamptz,'2026-01-02T09:19:00Z'::timestamptz,interval '1 minute') AS t`);
  const count = await db.query<{ count: string }>("SELECT count(*) FROM app.billing_periods WHERE society_id='fictional-demo'");
  await db.query('ANALYZE app.billing_periods');
  const plan = await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id,period_start,status FROM app.billing_periods WHERE society_id=$1 ORDER BY period_start DESC LIMIT 20', ['fictional-demo']);
  const result = { label, kind: 'injected_fault_test_fixture_query', scope: 'Local PostgreSQL manager-period list; 2000 synthetic period rows inserted in a rolled-back transaction, no HSB readings or real bills', query: 'SELECT id,period_start,status FROM app.billing_periods WHERE society_id=$1 ORDER BY period_start DESC LIMIT 20', datasetSize: Number(count.rows[0]!.count), sampledAt: new Date().toISOString(), plan: plan.rows[0]['QUERY PLAN'] };
  mkdirSync('tools/bench/results', { recursive: true });
  writeFileSync(`tools/bench/results/stage3-billing-query-${label}.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ label, datasetSize: result.datasetSize, executionTimeMs: (result.plan as { 'Execution Time': number }[])[0]?.['Execution Time'] }));
} finally { await db.query('ROLLBACK'); await db.end(); }
