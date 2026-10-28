import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import express from 'express';
import pg from 'pg';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { createIngestApp } from '../../apps/server/src/ingest.js';

if (existsSync('.env')) loadEnvFile('.env');
const pair = await generateKeyPair('ES256');
const jwk = await exportJWK(pair.publicKey); jwk.kid = 'stage3-playwright'; jwk.alg = 'ES256';
const database = 'water_metering_bench';
const pool = new pg.Pool({ host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432), database, user: 'app_rw', password: process.env.APP_RW_PASSWORD });
const setup = new pg.Client({ host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432), database, user: 'app_migrate', password: process.env.APP_MIGRATE_PASSWORD });
await setup.connect();
try { await setup.query('TRUNCATE app.explanation_cache,app.billing_idempotency,app.statement_lines,app.statements,app.audit_events,app.billing_revisions,app.billing_periods'); } finally { await setup.end(); }
const api = await createIngestApp({ pool, credential: 'playwright-only-ingestion-credential-000001', csvPath: 'tools/import-hsb/fixtures/hsb-sample-1000.csv', profilePath: 'docs/data/hsb-profile.json', webOrigin: 'http://127.0.0.1:5173', billing: { jwks: createLocalJWKSet({ keys: [jwk] }), issuer: 'http://127.0.0.1:3001/auth/v1', audience: 'authenticated' }, log: () => undefined });
const app = express();
app.use((req, res, next) => { if (req.header('origin') === 'http://127.0.0.1:5173') { res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5173'); res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, idempotency-key'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS'); } if (req.method === 'OPTIONS') { res.status(204).end(); return; } next(); });
app.post('/auth/v1/token', express.json(), async (req, res) => {
  const email = req.body?.email;
  const subject = email === 'manager@example.test' ? '11111111-1111-4111-8111-111111111111' : email === 'resident@example.test' ? '22222222-2222-4222-8222-222222222222' : null;
  if (!subject || req.body?.password !== 'fictional-demo-only') { res.status(400).json({ error: 'invalid_grant' }); return; }
  const accessToken = await new SignJWT({ role: 'authenticated', email }).setProtectedHeader({ alg: 'ES256', kid: 'stage3-playwright' }).setIssuer('http://127.0.0.1:3001/auth/v1').setAudience('authenticated').setSubject(subject).setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
  res.json({ access_token: accessToken, token_type: 'bearer', expires_in: 3600, refresh_token: 'fictional-playwright-refresh', user: { id: subject, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
});
app.use(api);
const server = app.listen(3001, '127.0.0.1');
process.on('SIGTERM', () => { server.close(); void pool.end(); });
