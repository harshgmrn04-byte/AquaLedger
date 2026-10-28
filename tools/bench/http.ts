import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import os from 'node:os';
import { parse } from 'csv-parse';
import pg from 'pg';
import { ADAPTER_VERSION, ARCHIVE_MD5, ARCHIVE_SHA256, canonicalParsedRowHash } from '@water/shared/hsb';
import { loadBenchmarkModule, verifyBenchmarkInputs } from './mode.js';
if (existsSync('.env')) loadEnvFile('.env');
const selected = await loadBenchmarkModule(process.argv[2] ?? '');
const mode = selected.mode;
const output = process.argv[3];
if (!output) throw new Error('usage: http.ts baseline|final output.json');
if (existsSync(output)) throw new Error(`Refusing to overwrite raw benchmark evidence: ${output}`);
const verifiedInputs = verifyBenchmarkInputs();
const csvPath = process.env.HSB_CSV_PATH ?? '/private/tmp/hsb-stage1/HSB_Living_Lab_Water_Consumption_Anonymized.csv';
const bytes = readFileSync(csvPath);
if (createHash('sha256').update(bytes).digest('hex') !== 'e9b8f34245b5cfb2b43d8fe3274056bcc5f3dca0cbf8904a6c4227ddd42d0be8') throw new Error('CSV checksum mismatch');
const rows: { csvLine: number; fields: Record<string, string> }[] = [];
for await (const item of createReadStream(csvPath).pipe(parse({ columns: true, delimiter: ';', info: true, bom: true }))) {
  rows.push({ csvLine: item.info.lines as number, fields: item.record as Record<string, string> });
  if (rows.length === 10000) break;
}
if (rows.length !== 10000) throw new Error('Not enough published rows');
const batchSize = 500, concurrency = 4;
const batches = Array.from({ length: rows.length / batchSize }, (_, i) => rows.slice(i * batchSize, (i + 1) * batchSize));
const scenarioHash = createHash('sha256').update(JSON.stringify({ rowHashes: rows.map(r => canonicalParsedRowHash(r.fields)), batchSize, concurrency })).digest('hex');
const common = { host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432), database: 'water_metering_bench' };
const migrate = new pg.Client({ ...common, user: 'app_migrate', password: process.env.APP_MIGRATE_PASSWORD });
const pool = new pg.Pool({ ...common, user: 'app_rw', password: process.env.APP_RW_PASSWORD, max: 5, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
const credential = 'local-benchmark-ingestion-credential-00000001';
await migrate.connect();
const migrationVersions = (await migrate.query<{ version: string }>('SELECT version FROM app.schema_migrations ORDER BY version')).rows.map(row => row.version);
if (JSON.stringify(migrationVersions) !== JSON.stringify(['001_source_events.sql', '002_limit_future_grants.sql', '003_ingestion_batches.sql'])) throw new Error('Benchmark database migrations do not match the pinned Stage 2 schema');
const app = await selected.createIngestApp({ pool, credential, csvPath, profilePath: 'docs/data/hsb-profile.json', log: () => undefined });
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No HTTP address');
const url = `http://127.0.0.1:${address.port}/api/v1/source-events/batches`;
const dbVersion = (await migrate.query<{ server_version: string }>('SHOW server_version')).rows[0]!.server_version;
async function reset() {
  await migrate.query('TRUNCATE app.source_event_conflicts, app.source_event_batches, app.source_events, app.import_runs, app.source_manifests RESTART IDENTITY CASCADE');
  const result = await pool.query<{ id: string }>(
    'INSERT INTO app.source_manifests(doi,dataset_version,archive_sha256,archive_md5,licence,adapter_version,source_unit_assumption) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    ['10.5281/zenodo.22076411', '1.1.0', ARCHIVE_SHA256, ARCHIVE_MD5, 'CC BY 4.0', ADAPTER_VERSION, 'value interpreted as m3 from aggregate cross-check; dictionary says litres']
  );
  return result.rows[0]!.id;
}
async function send(manifestId: string, events: typeof rows) {
  const start = performance.now();
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify({ sourceManifestId: manifestId, events }) });
  const data = await res.json() as { counts?: { accepted: number; duplicate: number; conflict: number; rejected: number }; error?: string };
  if (res.status !== 200 || !data.counts) throw new Error(`HTTP ${res.status} ${data.error}`);
  return { latencyMs: performance.now() - start, counts: data.counts };
}
async function run(manifestId: string) {
  const latencies: number[] = [];
  const totals = { accepted: 0, duplicate: 0, conflict: 0, rejected: 0 };
  let cursor = 0;
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < batches.length) {
      const batch = batches[cursor++]!;
      const response = await send(manifestId, batch);
      latencies.push(response.latencyMs);
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += response.counts[key];
    }
  }));
  const durationMs = performance.now() - start;
  const ordered = [...latencies].sort((a,b) => a-b);
  const quantile = (p: number) => ordered[Math.ceil(p * ordered.length)-1]!;
  return { durationMs, throughputEventsPerSec: rows.length / (durationMs / 1000), p50RequestMs: quantile(.5), p95RequestMs: quantile(.95), requestLatenciesMs: latencies, counts: totals };
}
const all: Awaited<ReturnType<typeof run>>[] = [];
try {
  const warmManifest = await reset();
  const warmup = await run(warmManifest);
  for (let i=0;i<5;i++) { const id = await reset(); all.push(await run(id)); }
  const replayManifest = '1';
  const replay = await run(replayManifest);
  const changed = structuredClone(rows[0]!);
  changed.fields.value = changed.fields.value === '0.01' ? '0.02' : '0.01';
  const conflict = await send(replayManifest, [changed]);
  const rowCount = (await pool.query<{ count: string }>('SELECT count(*) FROM app.source_events')).rows[0]!.count;
  const conflictCount = (await pool.query<{ count: string }>('SELECT count(*) FROM app.source_event_conflicts')).rows[0]!.count;
  const stats = (key: 'throughputEventsPerSec' | 'p50RequestMs' | 'p95RequestMs') => {
    const sorted = all.map(r => r[key]).sort((a,b) => a-b);
    return { median: sorted[2], min: sorted[0], max: sorted[4] };
  };
  const result = { mode, createdAt: new Date().toISOString(), execution: { modulePath: selected.path, moduleSha256: selected.sha256, persistence: mode === 'baseline' ? 'single_insert_per_event' : 'batched_insert' }, verifiedInputs, migrationVersions, source: { doi: '10.5281/zenodo.22076411', version: '1.1.0', archiveSha256: ARCHIVE_SHA256, csvSha256: 'e9b8f34245b5cfb2b43d8fe3274056bcc5f3dca0cbf8904a6c4227ddd42d0be8', adapterVersion: ADAPTER_VERSION }, scenario: { hash: scenarioHash, rows: rows.length, batchSize, concurrency, cleanDatabase: 'TRUNCATE all Stage 2 source tables and seed one pinned manifest before every warm-up/measured run' }, revision: { git: null, reason: 'repository has no commits', sourceSha256: selected.sha256 }, machine: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, ramBytes: os.totalmem(), os: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.version, postgresql: dbVersion }, commands: [`POSTGRES_DB=water_metering_bench CI=true npm run db:setup`, `POSTGRES_DB=water_metering_bench CI=true npm run db:migrate`, `HSB_CSV_PATH=${csvPath} node --import tsx tools/bench/http.ts ${mode} ${output}`], warmup, runs: all, acrossRun: { throughputEventsPerSec: stats('throughputEventsPerSec'), p50RequestMs: stats('p50RequestMs'), p95RequestMs: stats('p95RequestMs') }, replay: { ...replay, rowCountAfter: rowCount }, changedKey: { response: conflict, durableConflictCount: conflictCount } };
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, acrossRun: result.acrossRun, replay: replay.counts, conflict: conflict.counts, rowCount }));
} finally { server.close(); await pool.end(); await migrate.end(); }
