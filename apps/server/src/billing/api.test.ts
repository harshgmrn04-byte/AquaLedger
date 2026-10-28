import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import express from 'express';
import pg from 'pg';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { billingRoutes } from './api.js';

if (existsSync('.env')) loadEnvFile('.env');
const db = { host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432), database: 'water_metering_bench' };
const runtime = new pg.Pool({ ...db, user: 'app_rw', password: process.env.APP_RW_PASSWORD });
const migrate = new pg.Client({ ...db, user: 'app_migrate', password: process.env.APP_MIGRATE_PASSWORD });
const ids = { manager: '11111111-1111-4111-8111-111111111111', a: '22222222-2222-4222-8222-222222222222', b: '33333333-3333-4333-8333-333333333333', other: '55555555-5555-4555-8555-555555555555' };
let server: Server, base: string, privateKey: CryptoKey;
let groqMode: 'valid' | 'invalid' | 'limited' = 'valid', groqCalls = 0;
let fakeNow = 0;
async function token(subject: string) { return new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: 'local-test-key' }).setIssuer('http://local-auth.test').setAudience('authenticated').setSubject(subject).setIssuedAt().setExpirationTime('1h').sign(privateKey); }
type ApiBody = { id: string; periodId: string; previewHash: string; revisionId: string; error: string; statements: { totalMinor: string }[]; snapshot: { flatId: string; totalMinor: string }; periods: { id: string; status: string }[]; supersededByPeriodId: string | null };
async function call(path: string, subject: string | null, method = 'GET', body?: unknown, key?: string) {
  const response = await fetch(`${base}/api/v1${path}`, { method, headers: { ...(subject ? { authorization: `Bearer ${await token(subject)}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(key ? { 'idempotency-key': key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as ApiBody };
}
const bill = { periodStartLocal: '2026-01-01T00:00:00+05:30', periodEndLocal: '2026-01-01T01:00:00+05:30', currency: 'INR', invoiceVolumeMl: '5000', variableMinor: '500', fixedMinor: '200', totalMinor: '700' };
async function draft() { const result = await call('/billing-periods', ids.manager, 'POST', bill); expect(result.status).toBe(201); return result.body.id as string; }
beforeAll(async () => {
  await migrate.connect();
  const pair = await generateKeyPair('ES256'); privateKey = pair.privateKey;
  const publicJwk = await exportJWK(pair.publicKey); publicJwk.kid = 'local-test-key'; publicJwk.alg = 'ES256';
  const app = express(); app.use('/api/v1', express.json(), billingRoutes({ pool: runtime, jwks: createLocalJWKSet({ keys: [publicJwk] }), issuer: 'http://local-auth.test', audience: 'authenticated', groqKey: 'test-key', now: () => fakeNow, groqTransport: (async (_url: unknown, init?: RequestInit) => {
    groqCalls++;
    if (groqMode === 'limited') return new Response('{}', { status: 429 });
    if (groqMode === 'invalid') return new Response(JSON.stringify({ choices: [{ message: { content: '{bad' } }] }), { status: 200 });
    const sent = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    const input = JSON.parse(sent.messages[1]!.content) as { facts: { previous: unknown } };
    const selection = input.facts.previous ? { primaryReason: 'higher_variable_charge', factRefs: ['current_variable_minor', 'previous_variable_minor'], summary: 'The variable charge changed most.' } : { primaryReason: 'first_statement', factRefs: ['current_total_minor'], summary: 'This is the first statement.' };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(selection) } }] }), { status: 200 });
  }) as typeof fetch }));
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address'); base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await runtime.end(); await migrate.end(); });
beforeEach(async () => { fakeNow += 60_001; groqMode = 'valid'; groqCalls = 0; await migrate.query('TRUNCATE app.explanation_cache,app.billing_idempotency,app.statement_lines,app.statements,app.audit_events,app.billing_revisions,app.billing_periods'); });
describe('JWT and database-scoped billing API', () => {
  it('authorizes explanations, caches validated selections and misses a new revision', async () => {
    const id = await draft(); let preview = await call(`/billing-periods/${id}/preview`, ids.manager, 'POST', {});
    expect((await call(`/billing-periods/${id}/publish`, ids.manager, 'POST', { previewHash: preview.body.previewHash }, 'explain-1')).status).toBe(200);
    expect((await call(`/me/statements/${id}/explanation`, null)).status).toBe(401);
    expect((await call(`/me/statements/${id}/explanation`, ids.manager)).status).toBe(403);
    expect((await call(`/me/statements/${id}/explanation`, ids.other)).status).toBe(404);
    const initial = await call(`/me/statements/${id}/explanation`, ids.a);
    expect(initial.status).toBe(200);
    expect((initial.body as unknown as { source: string }).source).toBe('groq');
    expect(groqCalls).toBe(1);
    const cached = await call(`/me/statements/${id}/explanation`, ids.a);
    expect((cached.body as unknown as { source: string; callsAvoided: number }).source).toBe('cache');
    expect((cached.body as unknown as { callsAvoided: number }).callsAvoided).toBe(1);
    expect(groqCalls).toBe(1);
    expect((await call(`/billing-periods/${id}/revisions`, ids.manager, 'POST', {}, 'explain-revision')).status).toBe(200);
    expect((await call(`/billing-periods/${id}`, ids.manager, 'PUT', { ...bill, variableMinor: '600', totalMinor: '800' })).status).toBe(200);
    preview = await call(`/billing-periods/${id}/preview`, ids.manager, 'POST', {});
    expect((await call(`/billing-periods/${id}/publish`, ids.manager, 'POST', { previewHash: preview.body.previewHash }, 'explain-2')).status).toBe(200);
    const revised = await call(`/me/statements/${id}/explanation`, ids.a);
    expect((revised.body as unknown as { source: string }).source).toBe('groq');
    expect(groqCalls).toBe(2);
    expect((await call(`/me/statements/${id}/explanation?revision=1`, ids.a)).status).toBe(200);
    expect(groqCalls).toBe(2);
  });
  it('falls back on invalid model output and 429 without caching failures', async () => {
    const id = await draft(); const preview = await call(`/billing-periods/${id}/preview`, ids.manager, 'POST', {});
    expect((await call(`/billing-periods/${id}/publish`, ids.manager, 'POST', { previewHash: preview.body.previewHash }, 'fallback')).status).toBe(200);
    groqMode = 'invalid';
    const invalid = await call(`/me/statements/${id}/explanation`, ids.a);
    expect((invalid.body as unknown as { source: string; fallbackReason: string }).fallbackReason).toBe('invalid_output');
    groqMode = 'limited';
    const limited = await call(`/me/statements/${id}/explanation`, ids.a);
    expect((limited.body as unknown as { source: string; fallbackReason: string }).fallbackReason).toBe('rate_limited');
    expect((await runtime.query('SELECT count(*) FROM app.explanation_cache')).rows[0].count).toBe('0');
  });
  it('requires verified asymmetric JWT and PostgreSQL profile', async () => {
    expect((await call('/me', null)).status).toBe(401);
    expect((await call('/me', '99999999-9999-4999-8999-999999999999')).status).toBe(403);
    expect((await call('/billing-periods', ids.a, 'POST', bill)).status).toBe(403);
    expect((await call('/me/statements', ids.manager)).status).toBe(403);
  });
  it('rejects bad periods and invoice arithmetic before insert', async () => {
    expect((await call('/billing-periods', ids.manager, 'POST', { ...bill, periodStartLocal: '2026-01-01T00:00:00+00:00' })).status).toBe(400);
    expect((await call('/billing-periods', ids.manager, 'POST', { ...bill, totalMinor: '701' })).status).toBe(400);
    expect((await call('/billing-periods', ids.manager, 'POST', { ...bill, invoiceVolumeMl: '4999' })).status).toBe(400);
  });
  it('rejects sequential duplicate drafts with a reusable period ID and enforces the unique window in PostgreSQL', async () => {
    const id = await draft();
    const duplicate = await call('/billing-periods', ids.manager, 'POST', bill);
    expect(duplicate).toMatchObject({ status: 409, body: { error: 'billing_period_exists', periodId: id } });
    const rows = await runtime.query('SELECT count(*) FROM app.billing_periods WHERE society_id=$1 AND superseded_by_period_id IS NULL', ['fictional-demo']);
    expect(rows.rows[0].count).toBe('1');
    await expect(runtime.query("INSERT INTO app.billing_periods(id,society_id,period_start,period_end,currency,invoice_volume_ml,variable_minor,fixed_minor,total_minor,fixture_id,invoice_provenance) VALUES ($1,'fictional-demo',$2,$3,'INR',5000,500,200,700,'billing-demo-v1','illustrative_invoice')", [randomUUID(), bill.periodStartLocal, bill.periodEndLocal])).rejects.toMatchObject({ code: '23505' });
    await expect(runtime.query("INSERT INTO app.billing_periods(id,society_id,period_start,period_end,currency,invoice_volume_ml,variable_minor,fixed_minor,total_minor,fixture_id,invoice_provenance,superseded_by_period_id) VALUES ($1,'fictional-demo',$2,$3,'INR',5000,500,200,700,'billing-demo-v1','illustrative_invoice',$4)", [randomUUID(), bill.periodStartLocal, bill.periodEndLocal, id])).rejects.toMatchObject({ code: '42501' });
  });
  it('serializes concurrent duplicate creates while allowing the same window in another society', async () => {
    const [a, b] = await Promise.all([call('/billing-periods', ids.manager, 'POST', bill), call('/billing-periods', ids.manager, 'POST', bill)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const created = a.status === 201 ? a : b, conflict = a.status === 409 ? a : b;
    expect(conflict.body).toMatchObject({ error: 'billing_period_exists', periodId: created.body.id });
    const other = await call('/billing-periods', '44444444-4444-4444-8444-444444444444', 'POST', bill);
    expect(other.status).toBe(201);
    expect(other.body.id).not.toBe(created.body.id);
    expect((await runtime.query('SELECT count(*) FROM app.billing_periods WHERE superseded_by_period_id IS NULL')).rows[0].count).toBe('2');
  });
  it('blocks publication of a historical duplicate while retaining its prior statement for audit', async () => {
    const canonicalId = await draft();
    const preview = await call(`/billing-periods/${canonicalId}/preview`, ids.manager, 'POST', {});
    expect((await call(`/billing-periods/${canonicalId}/publish`, ids.manager, 'POST', { previewHash: preview.body.previewHash }, 'canonical')).status).toBe(200);
    expect((await call('/billing-periods', ids.manager, 'POST', bill)).body).toMatchObject({ error: 'billing_period_exists', periodId: canonicalId, status: 'published' });
    const legacyId = randomUUID(), revisionId = randomUUID(), statementId = randomUUID();
    await migrate.query("INSERT INTO app.billing_periods(id,society_id,period_start,period_end,currency,invoice_volume_ml,variable_minor,fixed_minor,total_minor,fixture_id,invoice_provenance,status,superseded_by_period_id) VALUES ($1,'fictional-demo',$2,$3,'INR',5000,500,200,700,'billing-demo-v1','illustrative_invoice','draft',$4)", [legacyId, bill.periodStartLocal, bill.periodEndLocal, canonicalId]);
    await migrate.query('INSERT INTO app.billing_revisions(id,period_id,revision_number,preview_hash,bill_version,input_cutoff,invoice_snapshot) VALUES ($1,$2,1,$3,1,now(),$4)', [revisionId, legacyId, preview.body.previewHash, JSON.stringify({ variableMinor: '500', fixedMinor: '200', totalMinor: '700', invoiceVolumeMl: '5000' })]);
    await migrate.query('INSERT INTO app.statements(id,revision_id,flat_id,volume_ml,variable_minor,shared_minor,fixed_minor,total_minor,snapshot) VALUES ($1,$2,$3,3000,300,0,100,400,$4)', [statementId, revisionId, 'DEMO_A', JSON.stringify({ flatId: 'DEMO_A', volumeMl: '3000', totalMinor: '400', fixtureProvenance: 'fictional_billing_fixture', invoiceProvenance: 'illustrative_invoice' })]);
    expect((await call(`/me/statements/${legacyId}?revision=1`, ids.a)).body).toMatchObject({ supersededByPeriodId: canonicalId, snapshot: { totalMinor: '400' } });
    expect((await call('/me/statements', ids.a)).body.statements).toHaveLength(1);
    expect(await call(`/billing-periods/${legacyId}/publish`, ids.manager, 'POST', { previewHash: preview.body.previewHash }, 'legacy')).toMatchObject({ status: 409, body: { error: 'superseded_billing_period' } });
    expect(await call(`/billing-periods/${legacyId}/revisions`, ids.manager, 'POST', {}, 'legacy-revision')).toMatchObject({ status: 409, body: { error: 'superseded_billing_period' } });
    expect((await runtime.query('SELECT count(*) FROM app.billing_revisions WHERE period_id=$1', [legacyId])).rows[0].count).toBe('1');
  });
  it('publishes exact totals, handles stale hash, idempotent retry and concurrent publish', async () => {
    const id = await draft();
    const first = await call(`/billing-periods/${id}/preview`, ids.manager, 'POST', {});
    expect(first.status).toBe(200); expect(first.body.statements.reduce((sum: bigint, s: { totalMinor: string }) => sum + BigInt(s.totalMinor), 0n)).toBe(700n);
    expect((await call(`/billing-periods/${id}`, ids.manager, 'PUT', { ...bill, variableMinor: '501', totalMinor: '701' })).status).toBe(200);
    expect((await call(`/billing-periods/${id}/publish`, ids.manager, 'POST', { previewHash: first.body.previewHash }, 'stale')).body.error).toBe('stale_preview');
    const fresh = await call(`/billing-periods/${id}/preview`, ids.manager, 'POST', {});
    const [a, b] = await Promise.all([call(`/billing-periods/${id}/publish`, ids.manager, 'POST', { previewHash: fresh.body.previewHash }, 'same'), call(`/billing-periods/${id}/publish`, ids.manager, 'POST', { previewHash: fresh.body.previewHash }, 'same')]);
    expect(a.status).toBe(200); expect(b.status).toBe(200); expect(a.body.revisionId).toBe(b.body.revisionId);
    expect((await call(`/billing-periods/${id}/publish`, ids.manager, 'POST', { previewHash: 'a'.repeat(64) }, 'same')).body.error).toBe('idempotency_key_reused');
    expect((await runtime.query('SELECT count(*) FROM app.billing_revisions WHERE period_id=$1', [id])).rows[0].count).toBe('1');
    expect((await runtime.query('SELECT sum(total_minor) AS total FROM app.statements')).rows[0].total).toBe('701');
  });
  it('serializes concurrent distinct publish keys to one revision', async () => {
    const id = await draft(); const preview = await call(`/billing-periods/${id}/preview`, ids.manager, 'POST', {});
    const results = await Promise.all(['concurrent-1', 'concurrent-2'].map(key => call(`/billing-periods/${id}/publish`, ids.manager, 'POST', { previewHash: preview.body.previewHash }, key)));
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await runtime.query('SELECT count(*) FROM app.billing_revisions WHERE period_id=$1', [id])).rows[0].count).toBe('1');
  });
  it('keeps previous revisions and denies cross-flat and cross-society reads', async () => {
    const id = await draft(); let preview = await call(`/billing-periods/${id}/preview`, ids.manager, 'POST', {});
    expect((await call(`/billing-periods/${id}/publish`, ids.manager, 'POST', { previewHash: preview.body.previewHash }, 'publish-1')).status).toBe(200);
    expect((await call(`/me/statements/${id}`, ids.a)).body.snapshot.flatId).toBe('DEMO_A');
    expect((await call(`/me/statements/${id}`, ids.b)).body.snapshot.flatId).toBe('DEMO_B');
    expect((await call(`/me/statements/${id}`, ids.other)).status).toBe(404);
    expect((await call(`/billing-periods/${id}/preview`, '44444444-4444-4444-8444-444444444444', 'POST', {})).status).toBe(404);
    const draftRevision = await call(`/billing-periods/${id}/revisions`, ids.manager, 'POST', {}, 'revision-1');
    expect(draftRevision.status).toBe(200);
    expect((await call(`/billing-periods/${id}/revisions`, ids.manager, 'POST', {}, 'revision-1')).body).toEqual(draftRevision.body);
    expect((await call(`/billing-periods/${id}`, ids.manager, 'PUT', { ...bill, variableMinor: '600', totalMinor: '800' })).status).toBe(200);
    preview = await call(`/billing-periods/${id}/preview`, ids.manager, 'POST', {});
    expect((await call(`/billing-periods/${id}/publish`, ids.manager, 'POST', { previewHash: preview.body.previewHash }, 'publish-2')).status).toBe(200);
    expect((await call(`/me/statements/${id}?revision=1`, ids.a)).body.snapshot.totalMinor).toBe('400');
    expect((await call(`/me/statements/${id}`, ids.a)).body.snapshot.totalMinor).toBe('460');
    expect((await runtime.query('SELECT count(*) FROM app.billing_revisions WHERE period_id=$1', [id])).rows[0].count).toBe('2');
    await expect(runtime.query("UPDATE app.statements SET total_minor=0 WHERE flat_id='DEMO_A'")).rejects.toMatchObject({ code: '42501' });
  });
});
