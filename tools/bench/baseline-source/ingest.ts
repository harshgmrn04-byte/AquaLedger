import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import express, { type ErrorRequestHandler } from 'express';
import { parse } from 'csv-parse';
import pg from 'pg';
import { z } from 'zod';
import { ADAPTER_VERSION, ARCHIVE_MD5, ARCHIVE_SHA256, HASH_CONTRACT, adaptRow, canonicalParsedRowHash, type SensorMap } from '@water/shared/hsb';

export const bodySchema = z.strictObject({
  sourceManifestId: z.string().regex(/^[1-9]\d*$/),
  events: z.array(z.unknown()).min(1).max(500)
});
const eventSchema = z.strictObject({ csvLine: z.number().int().min(2).max(652316), fields: z.record(z.string(), z.string()) });
type Event = ReturnType<typeof adaptRow>;
type Outcome = { index: number; status: 'accepted' | 'duplicate' | 'conflict' | 'rejected'; reasonCode: string };
export type IngestConfig = { pool: pg.Pool; credential: string; csvPath: string; profilePath: string; log?: (entry: Record<string, unknown>) => void };

function tokenMatches(header: string | undefined, credential: string): boolean {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const a = createHash('sha256').update(token).digest();
  const b = createHash('sha256').update(credential).digest();
  return token.length > 0 && timingSafeEqual(a, b);
}

export async function loadArchive(csvPath: string): Promise<Map<number, string>> {
  const bytes = readFileSync(csvPath);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (!['e9b8f34245b5cfb2b43d8fe3274056bcc5f3dca0cbf8904a6c4227ddd42d0be8', '14ee67cb19d5dea4004bc4cf873316db4db028d7cfb4621193741a6aeedf6e4d'].includes(digest)) throw new Error('Unaudited HSB CSV');
  const hashes = new Map<number, string>();
  for await (const item of createReadStream(csvPath).pipe(parse({ columns: true, delimiter: ';', info: true, bom: true }))) {
    hashes.set(item.info.lines as number, canonicalParsedRowHash(item.record as Record<string, unknown>));
  }
  return hashes;
}

export async function createIngestApp(config: IngestConfig) {
  const archiveHashes = await loadArchive(config.csvPath);
  const profile = z.object({ sensor_mapping: z.record(z.string(), z.array(z.array(z.string()))) }).parse(JSON.parse(readFileSync(config.profilePath, 'utf8')));
  const sensorMap: SensorMap = profile.sensor_mapping;
  const log = config.log ?? ((entry: Record<string, unknown>) => process.stdout.write(JSON.stringify(entry) + '\n'));
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const requestId = randomUUID();
    const start = process.hrtime.bigint();
    res.setHeader('X-Request-Id', requestId);
    res.locals.requestId = requestId;
    res.on('finish', () => log({ requestId, route: req.route?.path ?? req.path, status: res.statusCode, durationMs: Number(process.hrtime.bigint() - start) / 1e6, batchId: res.locals.batchId ?? null }));
    next();
  });
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', async (_req, res) => {
    try { await config.pool.query('SELECT 1'); res.json({ status: 'ok' }); }
    catch { res.status(503).json({ error: 'database_unavailable' }); }
  });
  app.post('/api/v1/source-events/batches', (req, res, next) => {
    if (!tokenMatches(req.headers.authorization, config.credential)) { res.status(401).json({ error: 'unauthorized' }); return; }
    next();
  }, express.json({ limit: '1mb', strict: true }), async (req, res) => {
    const body = bodySchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'invalid_batch' }); return; }
    const manifest = await config.pool.query<{ id: string }>(
      'SELECT id FROM app.source_manifests WHERE id=$1 AND doi=$2 AND dataset_version=$3 AND archive_sha256=$4 AND archive_md5=$5 AND adapter_version=$6 AND licence=$7',
      [body.data.sourceManifestId, '10.5281/zenodo.22076411', '1.1.0', ARCHIVE_SHA256, ARCHIVE_MD5, ADAPTER_VERSION, 'CC BY 4.0']
    );
    if (!manifest.rowCount) { res.status(400).json({ error: 'unauthorized_source_manifest' }); return; }
    const outcomes: Outcome[] = [];
    const valid: { index: number; event: Event }[] = [];
    for (const [index, input] of body.data.events.entries()) {
      const parsed = eventSchema.safeParse(input);
      if (!parsed.success) { outcomes.push({ index, status: 'rejected', reasonCode: 'invalid_event_shape' }); continue; }
      try {
        const event = adaptRow(parsed.data.fields, parsed.data.csvLine, sensorMap);
        valid.push({ index, event });
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        outcomes.push({ index, status: 'rejected', reasonCode: ['sensor_mapping_mismatch', 'invalid_utc_timestamp', 'non_positive_volume', 'invalid_source_field'].includes(code) ? code : 'invalid_source_fields' });
      }
    }
    const client = await config.pool.connect();
    try {
      await client.query('BEGIN');
      const conflicts: { key: string; existing: string; incoming: string }[] = [];
      for (const { index, event } of valid) {
        if (archiveHashes.get(Number(event.sourceRowKey.slice(4))) !== event.rowSha256) {
          const existing = await client.query<{ row_sha256: string }>('SELECT row_sha256 FROM app.source_events WHERE source_manifest_id=$1 AND source_row_key=$2', [body.data.sourceManifestId, event.sourceRowKey]);
          const prior = existing.rows[0]?.row_sha256;
          if (prior) { outcomes.push({ index, status: 'conflict', reasonCode: 'changed_source_row_key' }); conflicts.push({ key: event.sourceRowKey, existing: prior, incoming: event.rowSha256 }); }
          else outcomes.push({ index, status: 'rejected', reasonCode: 'archive_row_mismatch' });
          continue;
        }
        // This baseline intentionally executes one INSERT per valid event.
        const inserted = await client.query(
          `INSERT INTO app.source_events(source_manifest_id,source_row_key,source_sensor_id,apartment,fixture,channel,event_at,volume_ml,row_sha256)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
          [body.data.sourceManifestId, event.sourceRowKey, event.sourceSensorId, event.apartment, event.fixture, event.channel, event.timestamp, event.volumeMl, event.rowSha256]
        );
        if (inserted.rowCount) {
          outcomes.push({ index, status: 'accepted', reasonCode: 'inserted' });
          continue;
        }
        const existing = await client.query<{ row_sha256: string }>('SELECT row_sha256 FROM app.source_events WHERE source_manifest_id=$1 AND source_row_key=$2', [body.data.sourceManifestId, event.sourceRowKey]);
        const prior = existing.rows[0]?.row_sha256;
        if (prior === event.rowSha256) outcomes.push({ index, status: 'duplicate', reasonCode: 'same_canonical_row' });
        else if (prior) { outcomes.push({ index, status: 'conflict', reasonCode: 'changed_source_row_key' }); conflicts.push({ key: event.sourceRowKey, existing: prior, incoming: event.rowSha256 }); }
        else throw new Error('missing_conflict_row');
      }
      const count = (status: Outcome['status']) => outcomes.filter(x => x.status === status).length;
      const batch = await client.query<{ id: string }>(
        'INSERT INTO app.source_event_batches(source_manifest_id,request_id,accepted_count,duplicate_count,conflict_count,rejected_count) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [body.data.sourceManifestId, res.locals.requestId, count('accepted'), count('duplicate'), count('conflict'), count('rejected')]
      );
      const batchId = batch.rows[0]!.id;
      for (const conflict of conflicts) await client.query('INSERT INTO app.source_event_conflicts(source_manifest_id,source_row_key,existing_row_sha256,incoming_row_sha256,batch_id) VALUES ($1,$2,$3,$4,$5)', [body.data.sourceManifestId, conflict.key, conflict.existing, conflict.incoming, batchId]);
      await client.query('COMMIT');
      res.locals.batchId = batchId;
      outcomes.sort((a, b) => a.index - b.index);
      res.status(200).json({ requestId: res.locals.requestId, batchId, hashContract: HASH_CONTRACT, counts: { accepted: count('accepted'), duplicate: count('duplicate'), conflict: count('conflict'), rejected: count('rejected') }, outcomes });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      log({ requestId: res.locals.requestId, route: '/api/v1/source-events/batches', failure: 'database_or_archive_transaction' });
      res.status(503).json({ error: 'ingestion_unavailable', requestId: res.locals.requestId });
    } finally { client.release(); }
  });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof SyntaxError || (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large')) {
      res.status(error instanceof SyntaxError ? 400 : 413).json({ error: error instanceof SyntaxError ? 'invalid_json' : 'body_too_large' });
    } else { res.status(500).json({ error: 'internal_error' }); }
  };
  app.use(errors);
  return app;
}
