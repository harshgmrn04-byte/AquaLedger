import { readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

loadEnvFile('.env');
const env = z.object({ VITE_SUPABASE_URL: z.url(), VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(10), DEMO_MANAGER_EMAIL: z.email(), DEMO_MANAGER_PASSWORD: z.string().min(12), DEMO_B_EMAIL: z.email(), DEMO_B_PASSWORD: z.string().min(12) }).parse(process.env);
const api = 'https://aqualedger-api.onrender.com';
const periodId = z.uuid().parse((JSON.parse(readFileSync('docs/data/stage4-deployed-api-smoke.json', 'utf8')) as { periodId: string }).periodId);
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
async function signIn(email: string, password: string) { const { data, error } = await client.auth.signInWithPassword({ email, password }); if (error || !data.session) throw new Error(`Fictional sign-in failed: ${error?.status ?? 'unknown'}`); return data.session.access_token; }
const manager = await signIn(env.DEMO_MANAGER_EMAIL, env.DEMO_MANAGER_PASSWORD);
const resident = await signIn(env.DEMO_B_EMAIL, env.DEMO_B_PASSWORD);
type Check = { name: string; status: number; ms: number; requestId: string | null; source?: unknown; fallbackReason?: unknown; callsAvoided?: unknown; revisionNumber?: unknown };
const checks: Check[] = [];
async function call(name: string, token: string, path: string, method = 'GET', body?: object, idempotencyKey?: string) {
  const started = performance.now();
  const r = await fetch(`${api}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const j = await r.json() as Record<string, unknown>;
  checks.push({ name, status: r.status, ms: Math.round(performance.now() - started), requestId: r.headers.get('x-request-id'), ...(j.source ? { source: j.source } : {}), ...(j.fallbackReason ? { fallbackReason: j.fallbackReason } : {}), ...(j.callsAvoided !== undefined ? { callsAvoided: j.callsAvoided } : {}), ...(j.revisionNumber !== undefined ? { revisionNumber: j.revisionNumber } : {}) });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return j;
}
const current = await call('resident B revision before test', resident, `/me/statements/${periodId}`);
if (current.revisionNumber !== 2) throw new Error('Expected revision 2 before one controlled fictional revision');
await call('open fictional revision 3', manager, `/billing-periods/${periodId}/revisions`, 'POST', {}, 'stage4-deployed-open-v3');
const invoice = { periodStartLocal: '2026-01-01T00:00:00+05:30', periodEndLocal: '2026-01-01T01:00:00+05:30', currency: 'INR', invoiceVolumeMl: '5000', variableMinor: '2000', fixedMinor: '200', totalMinor: '2200' };
await call('update fictional revision 3', manager, `/billing-periods/${periodId}`, 'PUT', invoice);
const preview = await call('preview fictional revision 3', manager, `/billing-periods/${periodId}/preview`, 'POST');
if (typeof preview.previewHash !== 'string') throw new Error('No preview hash');
const published = await call('publish fictional revision 3', manager, `/billing-periods/${periodId}/publish`, 'POST', { previewHash: preview.previewHash }, 'stage4-deployed-publish-v3');
if (published.revisionNumber !== 3) throw new Error('Revision 3 publication failed');
for (const revision of [1, 2] as const) {
  const first = await call(`resident B revision ${revision} Groq`, resident, `/me/statements/${periodId}/explanation?revision=${revision}`);
  if (first.source !== 'groq') throw new Error(`Expected actual Groq selection for revision ${revision}, got ${String(first.source)}`);
  const repeat = await call(`resident B revision ${revision} cache`, resident, `/me/statements/${periodId}/explanation?revision=${revision}`);
  if (repeat.source !== 'cache' || repeat.callsAvoided !== 1) throw new Error(`Expected actual Groq cache hit for revision ${revision}`);
}
const limited = await call('resident B revision 3 bounded fallback', resident, `/me/statements/${periodId}/explanation?revision=3`);
if (limited.source !== 'fallback' || limited.fallbackReason !== 'request_limit') throw new Error('Expected deterministic per-resident request-limit fallback');
const prior = await call('resident B prior revision preserved', resident, `/me/statements/${periodId}?revision=1`);
if (prior.revisionNumber !== 1) throw new Error('Prior revision was not preserved');
const output = 'docs/data/stage4-deployed-model-smoke.json';
writeFileSync(output, JSON.stringify({ observedAt: new Date().toISOString(), api, periodId, checks, actualGroqCallsAvoided: 2, scope: 'fictional billing and deployed API' }, null, 2) + '\n');
console.log(JSON.stringify({ output, checkCount: checks.length, actualGroqCallsAvoided: 2, fallback: 'request_limit' }));
