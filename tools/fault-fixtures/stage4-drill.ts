import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { parse } from 'csv-parse/sync';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import pg from 'pg';
import { ADAPTER_VERSION, ARCHIVE_MD5, ARCHIVE_SHA256 } from '@water/shared/hsb';
import { createIngestApp } from '../../apps/server/src/ingest.js';

loadEnvFile('.env');
const db = { host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432), database: 'water_metering_bench' };
const migrate = new pg.Client({ ...db, user: 'app_migrate', password: process.env.APP_MIGRATE_PASSWORD });
const runtime = new pg.Pool({ ...db, user: 'app_rw', password: process.env.APP_RW_PASSWORD, connectionTimeoutMillis: 1000 });
const credential = 'drill-only-ingestion-credential-000000000001';
const logs: Record<string, unknown>[] = [];
const csvPath = 'tools/import-hsb/fixtures/hsb-sample-1000.csv';
const fields = (parse(readFileSync(csvPath, 'utf8'), { columns: true, delimiter: ';' }) as Record<string, string>[])[0]!;
const bill = { periodStartLocal: '2026-01-01T00:00:00+05:30', periodEndLocal: '2026-01-01T01:00:00+05:30', currency: 'INR', invoiceVolumeMl: '5000', variableMinor: '500', fixedMinor: '200', totalMinor: '700' };
type Reply = { status: number; requestId: string | null; body: Record<string, unknown> };
async function serve(app: Awaited<ReturnType<typeof createIngestApp>>) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No listener');
  return { base: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}
async function call(base: string, path: string, options: RequestInit = {}): Promise<Reply> {
  const response = await fetch(base + path, options);
  return { status: response.status, requestId: response.headers.get('x-request-id'), body: await response.json() as Record<string, unknown> };
}
const redact = (reply: Reply) => ({ status: reply.status, requestId: reply.requestId, error: reply.body.error ?? null, counts: reply.body.counts ?? null, source: reply.body.source ?? null, fallbackReason: reply.body.fallbackReason ?? null });
await migrate.connect();
try {
  await migrate.query('TRUNCATE app.explanation_cache,app.billing_idempotency,app.statement_lines,app.statements,app.audit_events,app.billing_revisions,app.billing_periods');
  await migrate.query('TRUNCATE app.source_event_conflicts,app.source_event_batches,app.source_events,app.import_runs,app.source_manifests RESTART IDENTITY CASCADE');
  const deadPool = new pg.Pool({ ...db, port: 1, user: 'app_rw', password: process.env.APP_RW_PASSWORD, connectionTimeoutMillis: 100 });
  const dead = await serve(await createIngestApp({ pool: deadPool, credential, csvPath, profilePath: 'docs/data/hsb-profile.json', log: entry => logs.push(entry) }));
  const health = await call(dead.base, '/healthz');
  const ready = await call(dead.base, '/readyz');
  await dead.close(); await deadPool.end();
  if (health.status !== 200 || ready.status !== 503) throw new Error('Database drill did not degrade as expected');

  const pair = await generateKeyPair('ES256');
  const jwk = await exportJWK(pair.publicKey); jwk.kid = 'drill-key'; jwk.alg = 'ES256';
  async function token(subject: string) { return new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: 'drill-key' }).setIssuer('http://local-auth.test').setAudience('authenticated').setSubject(subject).setIssuedAt().setExpirationTime('1h').sign(pair.privateKey); }
  let mode: 'rate' | 'timeout' | 'valid' = 'rate';
  let transportCalls = 0;
  const transport = (async () => { transportCalls++; if (mode === 'rate') return new Response('{}', { status: 429 }); if (mode === 'timeout') throw new DOMException('Injected timeout', 'TimeoutError'); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ primaryReason: 'first_statement', factRefs: ['current_total_minor'], summary: 'This is the first published statement.' }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 }); }) as typeof fetch;
  const live = await serve(await createIngestApp({ pool: runtime, credential, csvPath, profilePath: 'docs/data/hsb-profile.json', log: entry => logs.push(entry), billing: { jwks: createLocalJWKSet({ keys: [jwk] }), issuer: 'http://local-auth.test', audience: 'authenticated', groqKey: 'drill-only-key', groqTransport: transport } }));
  try {
    const manifest = await runtime.query<{ id: string }>('INSERT INTO app.source_manifests(doi,dataset_version,archive_sha256,archive_md5,licence,adapter_version,source_unit_assumption) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', ['10.5281/zenodo.22076411', '1.1.0', ARCHIVE_SHA256, ARCHIVE_MD5, 'CC BY 4.0', ADAPTER_VERSION, 'm3 inference; dictionary says litres']);
    const ingestOptions = { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify({ sourceManifestId: manifest.rows[0]!.id, events: [{ csvLine: 2, fields }] }) };
    const initial = await call(live.base, '/api/v1/source-events/batches', ingestOptions);
    const duplicate = await call(live.base, '/api/v1/source-events/batches', ingestOptions);
    if ((initial.body.counts as { accepted: number }).accepted !== 1 || (duplicate.body.counts as { duplicate: number }).duplicate !== 1) throw new Error('Duplicate replay drill failed');
    const manager = await token('11111111-1111-4111-8111-111111111111');
    const resident = await token('22222222-2222-4222-8222-222222222222');
    const json = (auth: string, body: unknown, key?: string) => ({ method: 'POST', headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) });
    const created = await call(live.base, '/api/v1/billing-periods', json(manager, bill));
    const id = String(created.body.id);
    const preview = await call(live.base, `/api/v1/billing-periods/${id}/preview`, json(manager, {}));
    await call(live.base, `/api/v1/billing-periods/${id}`, { method: 'PUT', headers: { authorization: `Bearer ${manager}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...bill, variableMinor: '501', totalMinor: '701' }) });
    const stale = await call(live.base, `/api/v1/billing-periods/${id}/publish`, json(manager, { previewHash: preview.body.previewHash }, randomUUID()));
    const fresh = await call(live.base, `/api/v1/billing-periods/${id}/preview`, json(manager, {}));
    const published = await call(live.base, `/api/v1/billing-periods/${id}/publish`, json(manager, { previewHash: fresh.body.previewHash }, randomUUID()));
    if (stale.status !== 409 || stale.body.error !== 'stale_preview' || published.status !== 200) throw new Error('Stale preview drill failed');
    const auth = { authorization: `Bearer ${resident}` };
    const rate = await call(live.base, `/api/v1/me/statements/${id}/explanation`, { headers: auth });
    mode = 'timeout';
    const timeout = await call(live.base, `/api/v1/me/statements/${id}/explanation`, { headers: auth });
    if (rate.body.fallbackReason !== 'rate_limited' || timeout.body.fallbackReason !== 'timeout') throw new Error(`Groq fallback drill failed: ${String(rate.body.fallbackReason)}, ${String(timeout.body.fallbackReason)}`);
    mode = 'valid';
    const residentB = await token('33333333-3333-4333-8333-333333333333');
    const bAuth = { authorization: `Bearer ${residentB}` };
    const beforeCache = transportCalls;
    const firstExplanation = await call(live.base, `/api/v1/me/statements/${id}/explanation`, { headers: bAuth });
    const secondExplanation = await call(live.base, `/api/v1/me/statements/${id}/explanation`, { headers: bAuth });
    const cacheProbe = { first: redact(firstExplanation), second: redact(secondExplanation), transportCalls: transportCalls - beforeCache, callsAvoided: secondExplanation.body.source === 'cache' ? 1 : 0, actualGroqCallsAvoided: 0 };
    if (firstExplanation.body.source !== 'groq' || secondExplanation.body.source !== 'cache' || cacheProbe.transportCalls !== 1) throw new Error('Cache drill failed');
    const ids = new Set([health, ready, initial, duplicate, stale, rate, timeout, firstExplanation, secondExplanation].map(item => item.requestId));
    const evidence = { at: new Date().toISOString(), environment: 'local_injected_fault_test', provenance: { sourceReplay: 'published_hsb_historical_event_subset', billing: 'fictional_billing_fixture' }, databaseUnavailable: { health: redact(health), readiness: redact(ready) }, duplicateReplay: { first: redact(initial), replay: redact(duplicate) }, stalePreview: redact(stale), groq: { rateLimited: redact(rate), timeout: redact(timeout), cacheProbe }, logs: logs.filter(item => ids.has(String(item.requestId))).map(item => ({ requestId: item.requestId, route: item.route, status: item.status, durationMs: item.durationMs, batchId: item.batchId, revisionId: item.revisionId, failureCategory: item.failureCategory })) };
    writeFileSync('docs/data/stage4-fault-drill.json', JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ output: 'docs/data/stage4-fault-drill.json', checks: ['database', 'duplicate', 'stale_preview', 'groq_429', 'groq_timeout'], logCount: evidence.logs.length }));
  } finally { await live.close(); }
} finally { await runtime.end(); await migrate.end(); }
