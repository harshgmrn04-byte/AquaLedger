import { createHash, randomUUID } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import type pg from 'pg';
import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { calculate, loadFixture, previewHash, type Invoice, type Fixture } from './allocation.js';
import { MODEL, PROMPT_VERSION, deterministicSelection, factsHash, renderExplanation, requestGroq, validateSelection, type Facts } from './explanation.js';

const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const bodySchema = z.strictObject({
  periodStartLocal: z.iso.datetime({ offset: true }), periodEndLocal: z.iso.datetime({ offset: true }),
  currency: z.literal('INR'), invoiceVolumeMl: decimal.nullable(),
  variableMinor: decimal, fixedMinor: decimal, totalMinor: decimal
});
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Profile = { auth_user_id: string; society_id: string; role: 'manager' | 'resident'; flat_id: string | null; timezone: string; fixture_id: string };
type Period = { id: string; society_id: string; period_start: Date; period_end: Date; currency: string; invoice_volume_ml: string | null; variable_minor: string; fixed_minor: string; total_minor: string; bill_version: number; status: string; superseded_by_period_id: string | null };
type UserResponse = { profile: Profile };

function invoiceOf(row: Period): Invoice { return { invoiceVolumeMl: row.invoice_volume_ml, variableMinor: row.variable_minor, fixedMinor: row.fixed_minor, totalMinor: row.total_minor }; }
function periodResponse(row: Period) { return { id: row.id, periodStartUtc: row.period_start.toISOString(), periodEndUtc: row.period_end.toISOString(), currency: row.currency, invoice: invoiceOf(row), billVersion: row.bill_version, status: row.status, fixtureProvenance: 'fictional_billing_fixture', invoiceProvenance: 'illustrative_invoice' }; }
function inputMatchesFixture(body: z.infer<typeof bodySchema>, fixture: Fixture, zone: string) {
  if (zone !== fixture.societyTimezone || Date.parse(body.periodStartLocal) !== Date.parse(fixture.periodStartLocal) || Date.parse(body.periodEndLocal) !== Date.parse(fixture.periodEndLocal) || body.periodStartLocal.slice(0, 19) !== fixture.periodStartLocal.slice(0, 19) || body.periodEndLocal.slice(0, 19) !== fixture.periodEndLocal.slice(0, 19)) throw new Error('invalid_fixture_period');
  calculate(fixture, { invoiceVolumeMl: body.invoiceVolumeMl, variableMinor: body.variableMinor, fixedMinor: body.fixedMinor, totalMinor: body.totalMinor });
}
function sendError(res: Parameters<RequestHandler>[1], error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505' && 'constraint' in error && error.constraint === 'billing_periods_one_active_window_idx') { res.status(409).json({ error: 'billing_period_exists' }); return; }
  const code = error instanceof Error ? error.message : 'internal_error';
  res.locals.failureCategory = code;
  const known = ['invalid_fixture_period', 'incomplete_fixture_coverage', 'ambiguous_flat_mapping', 'invoice_reconciliation_failed', 'invoice_volume_mismatch', 'zero_allocatable_volume', 'invalid_invoice', 'invalid_invoice_volume', 'fixture_flat_mapping_mismatch'];
  res.status(known.includes(code) ? 400 : code === 'not_found' ? 404 : ['not_draft', 'stale_preview', 'idempotency_key_reused', 'superseded_billing_period'].includes(code) ? 409 : 503).json({ error: known.includes(code) || ['not_found', 'not_draft', 'stale_preview', 'idempotency_key_reused', 'superseded_billing_period'].includes(code) ? code : 'billing_unavailable' });
}
async function verifyFixtureFlats(client: pg.PoolClient | pg.Pool, societyId: string, fixture: Fixture) {
  const rows = (await client.query<{ id: string }>('SELECT id FROM app.flats WHERE society_id=$1 ORDER BY id', [societyId])).rows.map(r => r.id);
  if (JSON.stringify(rows) !== JSON.stringify(fixture.flats.map(f => f.id).sort())) throw new Error('fixture_flat_mapping_mismatch');
}
export function billingRoutes(config: { pool: pg.Pool; jwks: JWTVerifyGetKey; issuer: string; audience: string; fixturePath?: string; groqKey?: string; groqTransport?: typeof fetch; now?: () => number }) {
  const router = Router();
  const fixture = loadFixture(config.fixturePath);
  const calls: number[] = [];
  const userCalls = new Map<string, number[]>();
  const inFlight = new Map<string, Promise<{ selection: ReturnType<typeof deterministicSelection>; source: 'groq' | 'fallback'; fallbackReason?: string; attempts: number | null }>>();
  const reserveCall = (user: string) => {
    const now = (config.now ?? Date.now)();
    const cutoff = now - 60_000;
    while (calls[0] !== undefined && calls[0] < cutoff) calls.shift();
    const own = (userCalls.get(user) ?? []).filter(time => time >= cutoff);
    userCalls.set(user, own);
    if (calls.length >= 5 || own.length >= 2) return false;
    calls.push(now); own.push(now); return true;
  };
  const authenticate: RequestHandler = async (req, res, next) => {
    const token = /^Bearer (\S+)$/.exec(req.header('authorization') ?? '')?.[1];
    if (!token) { res.status(401).json({ error: 'missing_token' }); return; }
    let subject: string;
    try {
      const { payload } = await jwtVerify(token, config.jwks, { issuer: config.issuer, audience: config.audience, algorithms: ['ES256', 'RS256'] });
      const parsed = z.uuid().safeParse(payload.sub);
      if (!parsed.success) { res.status(401).json({ error: 'invalid_token' }); return; }
      subject = parsed.data;
    } catch { res.status(401).json({ error: 'invalid_token' }); return; }
    try {
      const result = await config.pool.query<Profile>('SELECT p.auth_user_id,p.society_id,p.role,p.flat_id,s.timezone,s.fixture_id FROM app.profiles p JOIN app.societies s ON s.id=p.society_id WHERE p.auth_user_id=$1', [subject]);
      if (!result.rows[0]) { res.status(403).json({ error: 'profile_missing' }); return; }
      res.locals.profile = result.rows[0]; next();
    } catch { res.status(503).json({ error: 'authorization_unavailable' }); }
  };
  router.use(authenticate);
  const manager: RequestHandler = (_req, res, next) => { if ((res.locals as UserResponse).profile.role !== 'manager') { res.status(403).json({ error: 'manager_required' }); return; } next(); };
  const resident: RequestHandler = (_req, res, next) => { if ((res.locals as UserResponse).profile.role !== 'resident') { res.status(403).json({ error: 'resident_required' }); return; } next(); };
  const profile = (res: Parameters<RequestHandler>[1]) => (res.locals as UserResponse).profile;
  router.get('/me', (_req, res) => { const p = profile(res); res.json({ role: p.role, societyId: p.society_id, flatId: p.flat_id }); });
  const fetchPeriod = async (client: pg.Pool | pg.PoolClient, id: string, societyId: string, lock = false) => {
    const result = await client.query<Period>(`SELECT * FROM app.billing_periods WHERE id=$1 AND society_id=$2${lock ? ' FOR UPDATE' : ''}`, [id, societyId]);
    if (!result.rows[0]) throw new Error('not_found');
    if (result.rows[0].superseded_by_period_id) throw new Error('superseded_billing_period');
    return result.rows[0];
  };
  router.get('/billing-periods', manager, async (_req, res) => { try { const rows = await config.pool.query<Period>('SELECT * FROM app.billing_periods WHERE society_id=$1 AND superseded_by_period_id IS NULL ORDER BY period_start DESC LIMIT 20', [profile(res).society_id]); res.json({ periods: rows.rows.map(periodResponse) }); } catch (e) { sendError(res, e); } });
  router.post('/billing-periods', manager, async (req, res) => {
    const parsed = bodySchema.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: 'invalid_body' }); return; }
    try {
      inputMatchesFixture(parsed.data, fixture, profile(res).timezone); await verifyFixtureFlats(config.pool, profile(res).society_id, fixture);
      const b = parsed.data;
      const row = await config.pool.query<Period>('INSERT INTO app.billing_periods(id,society_id,period_start,period_end,currency,invoice_volume_ml,variable_minor,fixed_minor,total_minor,fixture_id,invoice_provenance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (society_id,period_start,period_end) WHERE superseded_by_period_id IS NULL DO NOTHING RETURNING *', [randomUUID(), profile(res).society_id, b.periodStartLocal, b.periodEndLocal, b.currency, b.invoiceVolumeMl, b.variableMinor, b.fixedMinor, b.totalMinor, 'billing-demo-v1', 'illustrative_invoice']);
      if (!row.rows[0]) {
        const existing = await config.pool.query<{ id: string; status: string }>('SELECT id,status FROM app.billing_periods WHERE society_id=$1 AND period_start=$2 AND period_end=$3 AND superseded_by_period_id IS NULL', [profile(res).society_id, b.periodStartLocal, b.periodEndLocal]);
        res.status(409).json({ error: 'billing_period_exists', periodId: existing.rows[0]?.id ?? null, status: existing.rows[0]?.status ?? null }); return;
      }
      res.status(201).json(periodResponse(row.rows[0]!));
    } catch (e) { sendError(res, e); }
  });
  router.put('/billing-periods/:id', manager, async (req, res) => {
    const parsed = bodySchema.safeParse(req.body); if (!parsed.success || !z.uuid().safeParse(req.params.id).success) { res.status(400).json({ error: 'invalid_body' }); return; }
    try {
      inputMatchesFixture(parsed.data, fixture, profile(res).timezone); const b = parsed.data;
      const row = await config.pool.query<Period>("UPDATE app.billing_periods SET period_start=$3,period_end=$4,currency=$5,invoice_volume_ml=$6,variable_minor=$7,fixed_minor=$8,total_minor=$9,bill_version=bill_version+1 WHERE id=$1 AND society_id=$2 AND status='draft' AND superseded_by_period_id IS NULL RETURNING *", [req.params.id, profile(res).society_id, b.periodStartLocal, b.periodEndLocal, b.currency, b.invoiceVolumeMl, b.variableMinor, b.fixedMinor, b.totalMinor]);
      if (!row.rows[0]) throw new Error('not_draft'); res.json(periodResponse(row.rows[0]));
    } catch (e) { sendError(res, e); }
  });
  router.post('/billing-periods/:id/preview', manager, async (req, res) => {
    try {
      const row = await fetchPeriod(config.pool, String(req.params.id), profile(res).society_id);
      if (row.status !== 'draft') throw new Error('not_draft'); await verifyFixtureFlats(config.pool, row.society_id, fixture);
      const invoice = invoiceOf(row), statements = calculate(fixture, invoice);
      res.json({ period: periodResponse(row), previewHash: previewHash(fixture, invoice, row.bill_version, statements), statements });
    } catch (e) { sendError(res, e); }
  });
  async function idempotent(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], operation: 'publish' | 'revision', run: (client: pg.PoolClient) => Promise<object>) {
    const key = req.header('idempotency-key');
    if (!key || key.length > 128 || !/^[\x21-\x7e]+$/.test(key)) { res.status(400).json({ error: 'invalid_idempotency_key' }); return; }
    const requestHash = hash({ periodId: req.params.id, body: req.body ?? null });
    const client = await config.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [profile(res).society_id, `${operation}:${key}`]);
      const old = await client.query<{ request_hash: string; response: object }>('SELECT request_hash,response FROM app.billing_idempotency WHERE society_id=$1 AND operation=$2 AND key=$3', [profile(res).society_id, operation, key]);
      if (old.rows[0]) {
        if (old.rows[0].request_hash !== requestHash) throw new Error('idempotency_key_reused');
        await client.query('COMMIT'); res.json(old.rows[0].response); return;
      }
      const response = await run(client);
      await client.query('INSERT INTO app.billing_idempotency(society_id,operation,key,request_hash,response) VALUES ($1,$2,$3,$4,$5)', [profile(res).society_id, operation, key, requestHash, JSON.stringify(response)]);
      await client.query('COMMIT'); res.json(response);
    } catch (e) { await client.query('ROLLBACK'); sendError(res, e); } finally { client.release(); }
  }
  router.post('/billing-periods/:id/publish', manager, async (req, res) => {
    const parsed = z.strictObject({ previewHash: z.string().regex(/^[0-9a-f]{64}$/) }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'invalid_body' }); return; }
    await idempotent(req, res, 'publish', async client => {
      const row = await fetchPeriod(client, String(req.params.id), profile(res).society_id, true);
      if (row.status !== 'draft') throw new Error('not_draft'); await verifyFixtureFlats(client, row.society_id, fixture);
      const invoice = invoiceOf(row), statements = calculate(fixture, invoice), currentHash = previewHash(fixture, invoice, row.bill_version, statements);
      if (currentHash !== parsed.data.previewHash) throw new Error('stale_preview');
      const latest = await client.query<{ next: number }>('SELECT COALESCE(max(revision_number),0)+1 AS next FROM app.billing_revisions WHERE period_id=$1', [row.id]);
      const revisionId = randomUUID(), revisionNumber = Number(latest.rows[0]!.next);
      await client.query('INSERT INTO app.billing_revisions(id,period_id,revision_number,preview_hash,bill_version,input_cutoff,invoice_snapshot) VALUES ($1,$2,$3,$4,$5,now(),$6)', [revisionId, row.id, revisionNumber, currentHash, row.bill_version, JSON.stringify(invoice)]);
      for (const statement of statements) {
        const statementId = randomUUID();
        await client.query('INSERT INTO app.statements(id,revision_id,flat_id,volume_ml,variable_minor,shared_minor,fixed_minor,total_minor,snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [statementId, revisionId, statement.flatId, statement.volumeMl, statement.variableMinor, statement.sharedMinor, statement.fixedMinor, statement.totalMinor, JSON.stringify(statement)]);
        for (const [kind, value] of [['variable', statement.variableMinor], ['shared', statement.sharedMinor], ['fixed', statement.fixedMinor]]) await client.query('INSERT INTO app.statement_lines(statement_id,kind,amount_minor) VALUES ($1,$2,$3)', [statementId, kind, value]);
      }
      await client.query("UPDATE app.billing_periods SET status='published' WHERE id=$1", [row.id]);
      await client.query('INSERT INTO app.audit_events(id,actor_id,period_id,revision_id,action) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), profile(res).auth_user_id, row.id, revisionId, 'published']);
      res.locals.revisionId = revisionId;
      return { periodId: row.id, revisionId, revisionNumber, previewHash: currentHash, status: 'published', fixtureProvenance: 'fictional_billing_fixture', invoiceProvenance: 'illustrative_invoice' };
    });
  });
  router.post('/billing-periods/:id/revisions', manager, async (req, res) => {
    if (req.body && Object.keys(req.body as object).length) { res.status(400).json({ error: 'invalid_body' }); return; }
    await idempotent(req, res, 'revision', async client => {
      const row = await fetchPeriod(client, String(req.params.id), profile(res).society_id, true);
      if (row.status !== 'published') throw new Error('not_draft');
      const latest = await client.query('SELECT 1 FROM app.billing_revisions WHERE period_id=$1 ORDER BY revision_number DESC LIMIT 1', [row.id]);
      if (!latest.rowCount) throw new Error('not_found');
      const updated = await client.query<Period>("UPDATE app.billing_periods SET status='draft',bill_version=bill_version+1 WHERE id=$1 RETURNING *", [row.id]);
      await client.query('INSERT INTO app.audit_events(id,actor_id,period_id,action) VALUES ($1,$2,$3,$4)', [randomUUID(), profile(res).auth_user_id, row.id, 'draft_revision_created']);
      return periodResponse(updated.rows[0]!);
    });
  });
  router.get('/me/statements', resident, async (_req, res) => {
    try {
      const rows = await config.pool.query('SELECT p.id AS "periodId",r.revision_number AS "revisionNumber",s.id AS "statementId",s.snapshot FROM app.statements s JOIN app.billing_revisions r ON r.id=s.revision_id JOIN app.billing_periods p ON p.id=r.period_id WHERE p.society_id=$1 AND p.superseded_by_period_id IS NULL AND s.flat_id=$2 AND r.revision_number=(SELECT max(revision_number) FROM app.billing_revisions WHERE period_id=p.id) ORDER BY p.period_start DESC', [profile(res).society_id, profile(res).flat_id]);
      res.json({ statements: rows.rows });
    } catch (e) { sendError(res, e); }
  });
  router.get('/me/statements/:id/explanation', resident, async (req, res) => {
    const revision = req.query.revision === undefined ? null : Number(req.query.revision);
    if (!z.uuid().safeParse(req.params.id).success || (revision !== null && (!Number.isSafeInteger(revision) || revision < 1))) { res.status(400).json({ error: 'invalid_query' }); return; }
    try {
      const rows = await config.pool.query<{ statement_id: string; revision_id: string; revision_number: number; snapshot: unknown }>(`SELECT s.id AS statement_id,r.id AS revision_id,r.revision_number,s.snapshot
        FROM app.statements s JOIN app.billing_revisions r ON r.id=s.revision_id JOIN app.billing_periods p ON p.id=r.period_id
        WHERE p.id=$1 AND p.society_id=$2 AND s.flat_id=$3 AND r.revision_number=COALESCE($4,(SELECT max(revision_number) FROM app.billing_revisions WHERE period_id=p.id))`, [req.params.id, profile(res).society_id, profile(res).flat_id, revision]);
      const row = rows.rows[0];
      if (!row) { res.status(404).json({ error: 'not_found' }); return; }
      const snapshotSchema = z.object({ variableMinor: decimal, fixedMinor: decimal, sharedMinor: decimal, totalMinor: decimal });
      const current = snapshotSchema.parse(row.snapshot);
      const prior = row.revision_number > 1 ? await config.pool.query<{ snapshot: unknown }>(`SELECT s.snapshot FROM app.statements s JOIN app.billing_revisions r ON r.id=s.revision_id
        WHERE r.period_id=$1 AND r.revision_number < $2 AND s.flat_id=$3 ORDER BY r.revision_number DESC LIMIT 1`, [req.params.id, row.revision_number, profile(res).flat_id]) : null;
      const previous = prior?.rows[0] ? snapshotSchema.parse(prior.rows[0].snapshot) : null;
      const facts: Facts = { statementId: row.statement_id, revisionId: row.revision_id, current, previous };
      const digest = factsHash(facts);
      const key = [row.statement_id, row.revision_id, MODEL, PROMPT_VERSION, digest].join(':');
      const cached = await config.pool.query<{ result: unknown }>('SELECT result FROM app.explanation_cache WHERE statement_id=$1 AND revision_id=$2 AND model=$3 AND prompt_version=$4 AND facts_hash=$5', [row.statement_id, row.revision_id, MODEL, PROMPT_VERSION, digest]);
      if (cached.rows[0]) {
        try { const selection = validateSelection(cached.rows[0].result, facts); res.json({ ...renderExplanation(selection, facts), source: 'cache', model: MODEL, promptVersion: PROMPT_VERSION, callsAvoided: 1 }); return; }
        catch { /* A stale or invalid entry is ignored; immutable revision/facts hash prevents reuse. */ }
      }
      let pending = inFlight.get(key);
      if (!pending) {
        pending = (async () => {
          if (!config.groqKey) return { selection: deterministicSelection(facts), source: 'fallback' as const, fallbackReason: 'missing_key', attempts: 0 };
          if (!reserveCall(profile(res).auth_user_id)) return { selection: deterministicSelection(facts), source: 'fallback' as const, fallbackReason: 'request_limit', attempts: 0 };
          try {
            const result = await requestGroq(facts, config.groqKey, config.groqTransport);
            await config.pool.query('INSERT INTO app.explanation_cache(statement_id,revision_id,model,prompt_version,facts_hash,result,prompt_tokens,completion_tokens) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING', [row.statement_id, row.revision_id, MODEL, PROMPT_VERSION, digest, JSON.stringify(result.selection), result.promptTokens, result.completionTokens]);
            return { selection: result.selection, source: 'groq' as const, attempts: result.attempts };
          } catch (error) {
            const message = error instanceof Error ? error.message : 'groq_unavailable';
            const fallbackReason = message === 'groq_rate_limited' ? 'rate_limited' : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : ['numeric_model_text', 'unsupported_reason', 'unsupported_fact_reference', 'invalid_model_output'].includes(message) || error instanceof SyntaxError || error instanceof z.ZodError ? 'invalid_output' : 'upstream_error';
            return { selection: deterministicSelection(facts), source: 'fallback' as const, fallbackReason, attempts: null };
          }
        })();
        inFlight.set(key, pending);
        void pending.finally(() => inFlight.delete(key));
      }
      const result = await pending;
      if (result.fallbackReason) res.locals.failureCategory = `groq_${result.fallbackReason}`;
      res.json({ ...renderExplanation(result.selection, facts), source: result.source, fallbackReason: result.fallbackReason ?? null, attempts: result.attempts, model: MODEL, promptVersion: PROMPT_VERSION, callsAvoided: 0 });
    } catch { res.status(503).json({ error: 'explanation_unavailable' }); }
  });
  router.get('/me/statements/:id', resident, async (req, res) => {
    const revision = req.query.revision === undefined ? null : Number(req.query.revision);
    if (!z.uuid().safeParse(req.params.id).success || (revision !== null && (!Number.isSafeInteger(revision) || revision < 1))) { res.status(400).json({ error: 'invalid_query' }); return; }
    try {
      const rows = await config.pool.query('SELECT p.id AS "periodId",p.superseded_by_period_id AS "supersededByPeriodId",r.revision_number AS "revisionNumber",r.published_at AS "publishedAt",s.id AS "statementId",s.snapshot,r.invoice_snapshot AS "invoiceSnapshot" FROM app.statements s JOIN app.billing_revisions r ON r.id=s.revision_id JOIN app.billing_periods p ON p.id=r.period_id WHERE p.id=$1 AND p.society_id=$2 AND s.flat_id=$3 AND r.revision_number=COALESCE($4,(SELECT max(revision_number) FROM app.billing_revisions WHERE period_id=p.id))', [req.params.id, profile(res).society_id, profile(res).flat_id, revision]);
      if (!rows.rows[0]) { res.status(404).json({ error: 'not_found' }); return; } res.json(rows.rows[0]);
    } catch (e) { sendError(res, e); }
  });
  return router;
}

