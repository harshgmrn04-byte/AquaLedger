import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { parse } from 'csv-parse';
import pg from 'pg';
import { z } from 'zod';
import { ADAPTER_VERSION, ARCHIVE_MD5, ARCHIVE_SHA256, adaptRow, classifyReplay, type SensorMap } from './adapter.js';

if (existsSync('.env')) loadEnvFile('.env');
const env = z.object({
  POSTGRES_HOST: z.string().default('127.0.0.1'),
  POSTGRES_PORT: z.coerce.number().int().default(5432),
  POSTGRES_DB: z.string().default('water_metering'),
  POSTGRES_USER: z.string().min(1).default('app_rw'),
  POSTGRES_SSL: z.enum(['disable', 'require']).default('disable'),
  POSTGRES_CA_PATH: z.string().optional(),
  HOSTED_SUPABASE: z.enum(['true', 'false']).default('false'),
  APP_RW_PASSWORD: z.string().min(12)
}).parse(process.env);
const args = process.argv.slice(2);
const get = (flag: string) => { const at = args.indexOf(flag); if (at < 0 || !args[at + 1]) throw new Error(`Missing ${flag}`); return args[at + 1]!; };
const archive = get('--archive');
const csv = get('--csv');
const out = get('--out');
const limit = z.coerce.number().int().min(1).max(10000).parse(get('--limit'));
const bytes = readFileSync(archive);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const md5 = createHash('md5').update(bytes).digest('hex');
if (sha256 !== ARCHIVE_SHA256 || md5 !== ARCHIVE_MD5) throw new Error('HSB archive checksum mismatch');
const csvSha256 = createHash('sha256').update(readFileSync(csv)).digest('hex');
if (env.HOSTED_SUPABASE === 'true' && (limit > 1000 || csvSha256 !== '14ee67cb19d5dea4004bc4cf873316db4db028d7cfb4621193741a6aeedf6e4d')) throw new Error('Hosted import permits only the audited 1,000-row subset');
if (![
  'e9b8f34245b5cfb2b43d8fe3274056bcc5f3dca0cbf8904a6c4227ddd42d0be8',
  '14ee67cb19d5dea4004bc4cf873316db4db028d7cfb4621193741a6aeedf6e4d'
].includes(csvSha256)) throw new Error('HSB CSV is not the audited full file or exact 1,000-row subset');
const map = JSON.parse(readFileSync('docs/data/hsb-profile.json', 'utf8')).sensor_mapping as SensorMap;
const client = new pg.Client({ host: env.POSTGRES_HOST, port: env.POSTGRES_PORT, database: env.POSTGRES_DB, user: env.POSTGRES_USER, password: env.APP_RW_PASSWORD, ssl: env.POSTGRES_SSL === 'require' ? { rejectUnauthorized: Boolean(env.POSTGRES_CA_PATH), ...(env.POSTGRES_CA_PATH ? { ca: readFileSync(env.POSTGRES_CA_PATH, 'utf8') } : {}) } : false, connectionTimeoutMillis: 5000 });
await client.connect();
let accepted = 0, duplicate = 0, rejected = 0;
const reasons: Record<string, number> = {};
try {
  await client.query('BEGIN');
  const insertedManifest = await client.query<{ id: string }>(
    `INSERT INTO app.source_manifests(doi,dataset_version,archive_sha256,archive_md5,licence,adapter_version,source_unit_assumption)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (doi,archive_sha256,adapter_version) DO NOTHING RETURNING id`,
    ['10.5281/zenodo.22076411', '1.1.0', sha256, md5, 'CC BY 4.0', ADAPTER_VERSION, 'value interpreted as m3 from aggregate cross-check; dictionary says litres']
  );
  const priorManifest = insertedManifest.rows[0] ? undefined : await client.query<{ id: string }>('SELECT id FROM app.source_manifests WHERE doi=$1 AND archive_sha256=$2 AND adapter_version=$3', ['10.5281/zenodo.22076411', sha256, ADAPTER_VERSION]);
  const manifestId = insertedManifest.rows[0]?.id ?? priorManifest?.rows[0]!.id;
  if (!manifestId) throw new Error('Manifest lookup failed');
  const stream = createReadStream(csv).pipe(parse({ columns: true, delimiter: ';', info: true, bom: true }));
  let processed = 0;
  for await (const item of stream) {
    if (processed >= limit) break;
    processed++;
    try {
      const event = adaptRow(item.record as unknown, item.info.lines as number, map);
      const insert = await client.query(
        `INSERT INTO app.source_events(source_manifest_id,source_row_key,source_sensor_id,apartment,fixture,channel,event_at,volume_ml,row_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
        [manifestId, event.sourceRowKey, event.sourceSensorId, event.apartment, event.fixture, event.channel, event.timestamp, event.volumeMl, event.rowSha256]
      );
      if (insert.rowCount) { accepted++; continue; }
      const existing = await client.query<{ row_sha256: string }>('SELECT row_sha256 FROM app.source_events WHERE source_manifest_id=$1 AND source_row_key=$2', [manifestId, event.sourceRowKey]);
      if (classifyReplay(existing.rows[0]?.row_sha256, event.rowSha256) === 'duplicate') duplicate++;
      else { rejected++; reasons.conflicting_source_row_key = (reasons.conflicting_source_row_key ?? 0) + 1; }
    } catch (error) {
      rejected++;
      const reason = error instanceof Error ? error.message.split('\n')[0]!.slice(0, 80) : 'unknown_adapter_error';
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
  }
  const run = await client.query<{ id: string }>(
    'INSERT INTO app.import_runs(source_manifest_id,subset_limit,accepted_count,duplicate_count,rejected_count,reasons) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [manifestId, limit, accepted, duplicate, rejected, JSON.stringify(reasons)]
  );
  await client.query('COMMIT');
  const result = { doi: '10.5281/zenodo.22076411', datasetVersion: '1.1.0', archiveSha256: sha256, archiveMd5: md5, csvSha256, licence: 'CC BY 4.0', adapterVersion: ADAPTER_VERSION, importRunId: run.rows[0]!.id, subsetLimit: limit, accepted, duplicate, rejected, reasons, sourceUnitAssumption: 'm3 inferred from published 3271 m3 total; dictionary disagrees', billingCoverageEligible: false };
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(`Import committed: accepted=${accepted} duplicate=${duplicate} rejected=${rejected}; manifest=${out}`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally { await client.end(); }
