import { writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

loadEnvFile('.env');
const env = z.object({
  VITE_SUPABASE_URL: z.url(), VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
  DEMO_MANAGER_EMAIL: z.email(), DEMO_MANAGER_PASSWORD: z.string().min(12),
  DEMO_A_EMAIL: z.email(), DEMO_A_PASSWORD: z.string().min(12),
  DEMO_B_EMAIL: z.email(), DEMO_B_PASSWORD: z.string().min(12)
}).parse(process.env);
const api = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3001';
const out = process.env.SMOKE_OUT ?? 'docs/data/stage4-hosted-local-api-smoke.json';
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
type Entry = { check: string; status: number; ms: number; requestId?: string | null; result?: string; source?: string; revisionNumber?: number; callsAvoided?: number };
const checks: Entry[] = [];
async function signIn(label: 'MANAGER' | 'A' | 'B') {
  const { data, error } = await client.auth.signInWithPassword({ email: env[`DEMO_${label}_EMAIL`], password: env[`DEMO_${label}_PASSWORD`] });
  if (error || !data.session?.access_token) throw new Error(`Fictional ${label} sign-in failed: ${error?.status ?? 'unknown'}`);
  return data.session.access_token;
}
async function request(check: string, path: string, token?: string, method = 'GET', body?: object, extra?: Record<string,string>) {
  const started = performance.now();
  const res = await fetch(`${api}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(extra ?? {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json: Record<string, unknown> = await res.json();
  checks.push({ check, status: res.status, ms: Math.round(performance.now()-started), requestId: res.headers.get('x-request-id'), ...(typeof json.error === 'string' ? { result: json.error } : {}), ...(typeof json.source === 'string' ? { source: json.source } : {}), ...(typeof json.revisionNumber === 'number' ? { revisionNumber: json.revisionNumber } : {}), ...(typeof json.callsAvoided === 'number' ? { callsAvoided: json.callsAvoided } : {}) });
  return { status: res.status, json };
}
function expectStatus(actual: number, expected: number, check: string) { if (actual !== expected) throw new Error(`${check}: expected ${expected}, got ${actual}`); }
const health = await request('health', '/healthz'); expectStatus(health.status, 200, 'health');
const ready = await request('readiness', '/readyz'); expectStatus(ready.status, 200, 'readiness');
const manager = await signIn('MANAGER'), a = await signIn('A'), b = await signIn('B');
const anonymous = await request('anonymous profile denied', '/api/v1/me'); expectStatus(anonymous.status, 401, 'anonymous profile');
for (const [name, token, role] of [['manager',manager,'manager'],['resident A',a,'resident'],['resident B',b,'resident']] as const) {
  const me = await request(`${name} profile`, '/api/v1/me', token); expectStatus(me.status, 200, name);
  if (me.json.role !== role) throw new Error(`${name}: wrong role`);
}
const residentManager = await request('resident manager route denied', '/api/v1/billing-periods', a); expectStatus(residentManager.status, 403, 'resident manager route');
const managerResident = await request('manager resident route denied', '/api/v1/me/statements', manager); expectStatus(managerResident.status, 403, 'manager resident route');
const base = { periodStartLocal: '2026-01-01T00:00:00+05:30', periodEndLocal: '2026-01-01T01:00:00+05:30', currency: 'INR', invoiceVolumeMl: '5000', variableMinor: '1000', fixedMinor: '200', totalMinor: '1200' };
const created = await request('create fictional period', '/api/v1/billing-periods', manager, 'POST', base);
if (created.status === 409 && typeof created.json.periodId === 'string') {
  const periods = await request('list existing fictional periods', '/api/v1/billing-periods', manager);
  if (periods.status !== 200 || !Array.isArray(periods.json.periods)) throw new Error('Cannot load existing period');
  const existing = (periods.json.periods as Array<Record<string,unknown>>).find(p=>p.id===created.json.periodId);
  if (!existing || existing.status !== 'published') throw new Error('Existing fictional period cannot be safely reused');
} else expectStatus(created.status, 201, 'create period');
const periodId = created.json.id ?? created.json.periodId;
if (typeof periodId !== 'string') throw new Error('Missing fictional period ID');
if (created.status === 201) {
  const preview = await request('preview fictional period', `/api/v1/billing-periods/${periodId}/preview`, manager, 'POST'); expectStatus(preview.status, 200, 'preview');
  if (typeof preview.json.previewHash !== 'string') throw new Error('Missing preview hash');
  const publish = await request('publish fictional revision 1', `/api/v1/billing-periods/${periodId}/publish`, manager, 'POST', { previewHash: preview.json.previewHash }, { 'Idempotency-Key': 'stage4-hosted-publish-v1' }); expectStatus(publish.status, 200, 'publish 1');
}
const statementA1 = await request('resident A statement', `/api/v1/me/statements/${periodId}`, a); expectStatus(statementA1.status, 200, 'resident A statement');
const statementB1 = await request('resident B statement', `/api/v1/me/statements/${periodId}`, b); expectStatus(statementB1.status, 200, 'resident B statement');
if (statementA1.json.statementId === statementB1.json.statementId || statementA1.json.snapshot?.['flatId'] !== 'DEMO_A' || statementB1.json.snapshot?.['flatId'] !== 'DEMO_B') throw new Error('Cross-flat statement isolation failed');
const explanation1 = await request('resident A explanation revision 1', `/api/v1/me/statements/${periodId}/explanation?revision=1`, a); expectStatus(explanation1.status, 200, 'explanation 1');
const repeated = await request('resident A explanation cache', `/api/v1/me/statements/${periodId}/explanation?revision=1`, a); expectStatus(repeated.status, 200, 'explanation cache');
if (explanation1.json.source === 'groq' && (repeated.json.source !== 'cache' || repeated.json.callsAvoided !== 1)) throw new Error('Groq cache miss on repeated revision');
if (created.status === 201) {
  const revision = await request('open fictional revision 2', `/api/v1/billing-periods/${periodId}/revisions`, manager, 'POST', undefined, { 'Idempotency-Key': 'stage4-hosted-open-v2' }); expectStatus(revision.status, 200, 'open revision');
  const updated = await request('change fictional invoice', `/api/v1/billing-periods/${periodId}`, manager, 'PUT', { ...base, variableMinor: '1500', totalMinor: '1700' }); expectStatus(updated.status, 200, 'update invoice');
  const preview2 = await request('preview fictional revision 2', `/api/v1/billing-periods/${periodId}/preview`, manager, 'POST'); expectStatus(preview2.status, 200, 'preview 2');
  const publish2 = await request('publish fictional revision 2', `/api/v1/billing-periods/${periodId}/publish`, manager, 'POST', { previewHash: preview2.json.previewHash }, { 'Idempotency-Key': 'stage4-hosted-publish-v2' }); expectStatus(publish2.status, 200, 'publish 2');
}
const latest = await request('resident A latest revision', `/api/v1/me/statements/${periodId}`, a); expectStatus(latest.status, 200, 'latest revision');
const prior = await request('resident A prior revision remains', `/api/v1/me/statements/${periodId}?revision=1`, a); expectStatus(prior.status, 200, 'prior revision');
if (typeof latest.json.revisionNumber !== 'number' || latest.json.revisionNumber < 2 || prior.json.revisionNumber !== 1) throw new Error('Published revision check failed');
const latestExplanation = await request('resident A revision 2 explanation', `/api/v1/me/statements/${periodId}/explanation`, a); expectStatus(latestExplanation.status, 200, 'latest explanation');
const latestCached = await request('resident A revision 2 cache', `/api/v1/me/statements/${periodId}/explanation`, a); expectStatus(latestCached.status, 200, 'latest cache');
if (latestExplanation.json.source === 'groq' && (latestCached.json.source !== 'cache' || latestCached.json.callsAvoided !== 1)) throw new Error('Revision 2 cache miss');
const boundary = [];
for (const [label, token] of [['unauthenticated',null],['authenticated resident',a]] as const) {
  const started=performance.now();
  const res=await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/societies?select=id`, { headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Accept-Profile':'app', ...(token ? {Authorization:`Bearer ${token}`} : {}) } });
  boundary.push({ actor: label, status: res.status, ms: Math.round(performance.now()-started) });
  if (res.ok) throw new Error(`Data API exposed app schema to ${label}`);
}
writeFileSync(out, JSON.stringify({ kind:'hosted Supabase plus local API smoke', observedAt:new Date().toISOString(), api, periodId, checks, dataApiBoundary:boundary, groqHttpCallsAvoided:checks.filter(c=>c.source==='cache').length },null,2)+'\n');
console.log(JSON.stringify({out,checkCount:checks.length,dataApiStatuses:boundary.map(b=>b.status),groqHttpCallsAvoided:checks.filter(c=>c.source==='cache').length}));
