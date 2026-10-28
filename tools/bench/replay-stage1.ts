import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { parse } from 'csv-parse/sync';
import pg from 'pg';
import { ADAPTER_VERSION, ARCHIVE_SHA256 } from '@water/shared/hsb';
import { createIngestApp } from '../../apps/server/src/ingest.js';
if (existsSync('.env')) loadEnvFile('.env');
const pool = new pg.Pool({ host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432), database: process.env.POSTGRES_DB ?? 'water_metering', user: 'app_rw', password: process.env.APP_RW_PASSWORD, max: 5 });
const credential = 'local-stage1-replay-ingestion-credential-01';
const rows = parse(readFileSync('tools/import-hsb/fixtures/hsb-sample-1000.csv', 'utf8'), { columns: true, delimiter: ';' }) as Record<string, string>[];
const app = await createIngestApp({ pool, credential, csvPath: 'tools/import-hsb/fixtures/hsb-sample-1000.csv', profilePath: 'docs/data/hsb-profile.json', log: () => undefined });
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No address');
try {
  const manifest = await pool.query<{ id: string }>('SELECT id FROM app.source_manifests WHERE doi=$1 AND archive_sha256=$2 AND adapter_version=$3', ['10.5281/zenodo.22076411', ARCHIVE_SHA256, ADAPTER_VERSION]);
  if (!manifest.rowCount) throw new Error('Stage 1 manifest missing');
  const manifestId = manifest.rows[0]!.id;
  const before = Number((await pool.query('SELECT count(*) FROM app.source_events WHERE source_manifest_id=$1', [manifestId])).rows[0].count);
  const totals = { accepted: 0, duplicate: 0, conflict: 0, rejected: 0 };
  for (let start=0; start<1000; start+=500) {
    const events = rows.slice(start,start+500).map((fields,i) => ({ csvLine: start+i+2, fields }));
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/source-events/batches`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify({ sourceManifestId: manifestId, events }) });
    const data = await response.json() as { counts?: typeof totals; error?: string };
    if (response.status !== 200 || !data.counts) throw new Error(`Replay failed: ${response.status} ${data.error}`);
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += data.counts[key];
  }
  const after = Number((await pool.query('SELECT count(*) FROM app.source_events WHERE source_manifest_id=$1', [manifestId])).rows[0].count);
  const result = { before, after, newRows: after-before, counts: totals, manifestId, adapterVersion: ADAPTER_VERSION };
  if (before < 1000 || after !== before || totals.duplicate !== 1000 || totals.accepted !== 0 || totals.conflict !== 0 || totals.rejected !== 0) throw new Error(`Stage 1 replay invariant failed: ${JSON.stringify(result)}`);
  writeFileSync('tools/bench/results/stage1-http-replay.json', JSON.stringify(result, null, 2)+'\n');
  console.log(JSON.stringify(result));
} finally { server.close(); await pool.end(); }
