import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import type { Server } from 'node:http';
import { parse } from 'csv-parse/sync';
import pg from 'pg';
import { ADAPTER_VERSION, ARCHIVE_MD5, ARCHIVE_SHA256 } from '@water/shared/hsb';
import { createIngestApp } from './ingest.js';
if (existsSync('.env')) loadEnvFile('.env');
const db = { host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432), database: 'water_metering_bench' };
const runtime = new pg.Pool({ ...db, user: 'app_rw', password: process.env.APP_RW_PASSWORD, max: 5 });
const migrate = new pg.Client({ ...db, user: 'app_migrate', password: process.env.APP_MIGRATE_PASSWORD });
const credential = 'integration-ingestion-credential-00000001';
const rows = parse(readFileSync('tools/import-hsb/fixtures/hsb-sample-1000.csv', 'utf8'), { columns: true, delimiter: ';' }) as Record<string, string>[];
const event = (line: number) => ({ csvLine: line, fields: { ...rows[line - 2]! } });
let server: Server;
let url: string;
let manifestId: string;
const logs: Record<string, unknown>[] = [];
async function start() {
  const app = await createIngestApp({ pool: runtime, credential, csvPath: 'tools/import-hsb/fixtures/hsb-sample-1000.csv', profilePath: 'docs/data/hsb-profile.json', log: entry => logs.push(entry) });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  url = `http://127.0.0.1:${address.port}/api/v1/source-events/batches`;
}
async function close() { await new Promise<void>(resolve => server.close(() => resolve())); }
async function post(events: unknown[], auth = true, sourceManifestId = manifestId) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify({ sourceManifestId, events }) });
  return { status: response.status, body: await response.json() as { counts?: Record<string, number>; outcomes?: { status: string; reasonCode: string }[]; error?: string; requestId?: string } };
}
async function count(table: 'source_events' | 'source_event_conflicts') { return Number((await runtime.query(`SELECT count(*) FROM app.${table}`)).rows[0].count); }
beforeAll(async () => { await migrate.connect(); await start(); });
afterAll(async () => { await close(); await runtime.end(); await migrate.end(); });
beforeEach(async () => {
  logs.length = 0;
  await migrate.query('DROP TRIGGER IF EXISTS fail_test_insert ON app.source_events');
  await migrate.query('DROP FUNCTION IF EXISTS app.fail_test_insert()');
  await migrate.query('TRUNCATE app.source_event_conflicts, app.source_event_batches, app.source_events, app.import_runs, app.source_manifests RESTART IDENTITY CASCADE');
  manifestId = (await runtime.query<{ id: string }>('INSERT INTO app.source_manifests(doi,dataset_version,archive_sha256,archive_md5,licence,adapter_version,source_unit_assumption) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', ['10.5281/zenodo.22076411', '1.1.0', ARCHIVE_SHA256, ARCHIVE_MD5, 'CC BY 4.0', ADAPTER_VERSION, 'm3 inference; dictionary says litres'])).rows[0]!.id;
});
describe('authenticated HSB event ingestion with real PostgreSQL', () => {
  it('logs the full mounted route and request ID without the ingestion credential', async () => {
    const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${credential}` } });
    expect(response.status).toBe(400);
    expect(logs.at(-1)).toMatchObject({ route: '/api/v1/source-events/batches', status: 400, requestId: response.headers.get('x-request-id') });
    expect(JSON.stringify(logs.at(-1))).not.toContain(credential);
  });
  it('rejects unauthorized, malformed, oversized and over-500 batches without writes', async () => {
    expect((await post([event(2)], false)).status).toBe(401);
    expect((await post([event(2)], true, '999999')).status).toBe(400);
    expect((await post(Array.from({ length: 501 }, () => event(2)))).status).toBe(400);
    const big = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify({ sourceManifestId: manifestId, events: [{ csvLine: 2, fields: { huge: 'x'.repeat(1_100_000) } }] }) });
    expect(big.status).toBe(413);
    const malformed = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: '{' });
    expect(malformed.status).toBe(400);
    expect(await count('source_events')).toBe(0);
  });
  it('accepts out-of-order rows and distinct physical lines with the same sensor and timestamp', async () => {
    const response = await post([event(10), event(2), event(627), event(631)]);
    expect(response.body.counts).toMatchObject({ accepted: 4, duplicate: 0, conflict: 0, rejected: 0 });
    expect(response.body.outcomes?.map(x => x.status)).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
    expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await count('source_events')).toBe(4);
    const analytics = await fetch(url.replace('/batches', '/summary'));
    const summary = await analytics.json() as { provenance: string; eventCount: string; coverageCertified: boolean; eventVolumeMl: string };
    expect(summary).toMatchObject({ provenance: 'observed_source_event_analytics', eventCount: '4', coverageCertified: false });
    expect(BigInt(summary.eventVolumeMl)).toBeGreaterThan(0n);
    const same = await runtime.query('SELECT source_sensor_id,event_at,count(*) FROM app.source_events WHERE source_row_key IN ($1,$2) GROUP BY source_sensor_id,event_at', ['csv:0000627', 'csv:0000631']);
    expect(Number(same.rows[0]?.count)).toBe(2);
  });
  it('classifies duplicates, changed keys and partial item rejection with stable reasons and a durable conflict', async () => {
    expect((await post([event(2)])).body.counts?.accepted).toBe(1);
    const changed = event(2); changed.fields.value = '0.02';
    const unmapped = event(3); unmapped.fields.apartment = 'APT_999';
    const mismatch = event(4); mismatch.fields.value = '0.02';
    const response = await post([event(2), changed, unmapped, mismatch, event(5)]);
    expect(response.body.counts).toMatchObject({ accepted: 1, duplicate: 1, conflict: 1, rejected: 2 });
    expect(response.body.outcomes?.map(x => x.reasonCode)).toEqual(['same_canonical_row', 'changed_source_row_key', 'sensor_mapping_mismatch', 'archive_row_mismatch', 'inserted']);
    expect(await count('source_event_conflicts')).toBe(1);
    expect(await count('source_events')).toBe(2);
  });
  it('rejects client-provided provenance and hash fields', async () => {
    const forged = { ...event(2), provenance: 'observed_source_measurement', rowSha256: 'a'.repeat(64) };
    const response = await post([forged, event(3)]);
    expect(response.body.counts).toMatchObject({ accepted: 1, rejected: 1 });
    expect(response.body.outcomes?.[0]?.reasonCode).toBe('invalid_event_shape');
    expect(await count('source_events')).toBe(1);
  });
  it('reports database unavailability with a request ID and no writes', async () => {
    const unavailablePool = new pg.Pool({ ...db, port: 1, user: 'app_rw', password: process.env.APP_RW_PASSWORD, connectionTimeoutMillis: 100 });
    const unavailableApp = await createIngestApp({ pool: unavailablePool, credential, csvPath: 'tools/import-hsb/fixtures/hsb-sample-1000.csv', profilePath: 'docs/data/hsb-profile.json', log: () => undefined });
    const unavailableServer = unavailableApp.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => unavailableServer.once('listening', resolve));
    const address = unavailableServer.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/source-events/batches`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify({ sourceManifestId: manifestId, events: [event(2)] }) });
      const body = await response.json() as { error: string; requestId: string };
      expect(response.status).toBe(503);
      expect(body.error).toBe('ingestion_unavailable');
      expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(await count('source_events')).toBe(0);
    } finally { await new Promise<void>(resolve => unavailableServer.close(() => resolve())); await unavailablePool.end(); }
  });
  it('rolls back all accepted rows and audit records when a PostgreSQL trigger fails, then retries after restart', async () => {
    await migrate.query("CREATE FUNCTION app.fail_test_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_row_key='csv:0000003' THEN RAISE EXCEPTION 'injected test failure'; END IF; RETURN NEW; END $$");
    await migrate.query('CREATE TRIGGER fail_test_insert BEFORE INSERT ON app.source_events FOR EACH ROW EXECUTE FUNCTION app.fail_test_insert()');
    expect((await post([event(2), event(3)])).status).toBe(503);
    expect(await count('source_events')).toBe(0);
    expect(Number((await runtime.query('SELECT count(*) FROM app.source_event_batches')).rows[0].count)).toBe(0);
    await migrate.query('DROP TRIGGER fail_test_insert ON app.source_events');
    await migrate.query('DROP FUNCTION app.fail_test_insert()');
    await close(); await start();
    expect((await post([event(2), event(3)])).body.counts?.accepted).toBe(2);
    await close(); await start();
    expect((await post([event(2), event(3)])).body.counts?.duplicate).toBe(2);
    expect(await count('source_events')).toBe(2);
  });
});
