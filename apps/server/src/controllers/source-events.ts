import type { RequestHandler } from 'express';
import type pg from 'pg';
import { ADAPTER_VERSION, ARCHIVE_MD5, ARCHIVE_SHA256, HASH_CONTRACT, adaptRow, type SensorMap } from '@water/shared/hsb';
import { bodySchema, eventSchema, type Outcome } from '../schemas/ingestion.js';
import { persistBatch, type ValidEvent } from '../services/persist-batch.js';

type BatchDependencies = {
  pool: pg.Pool;
  archiveHashes: Map<number, string>;
  sensorMap: SensorMap;
  log: (entry: Record<string, unknown>) => void;
};

export function createSourceEventController({ pool, archiveHashes, sensorMap, log }: BatchDependencies): RequestHandler {
  return async (req, res) => {
    const body = bodySchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'invalid_batch' }); return; }
    let manifest: pg.QueryResult<{ id: string }>;
    try {
      manifest = await pool.query<{ id: string }>(
        'SELECT id FROM app.source_manifests WHERE id=$1 AND doi=$2 AND dataset_version=$3 AND archive_sha256=$4 AND archive_md5=$5 AND adapter_version=$6 AND licence=$7',
        [body.data.sourceManifestId, '10.5281/zenodo.22076411', '1.1.0', ARCHIVE_SHA256, ARCHIVE_MD5, ADAPTER_VERSION, 'CC BY 4.0']
      );
    } catch {
      log({ requestId: res.locals.requestId, route: '/api/v1/source-events/batches', failure: 'manifest_lookup_unavailable' });
      res.status(503).json({ error: 'ingestion_unavailable', requestId: res.locals.requestId });
      return;
    }
    if (!manifest.rowCount) { res.status(400).json({ error: 'unauthorized_source_manifest' }); return; }
    const outcomes: Outcome[] = [];
    const valid: ValidEvent[] = [];
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
    let client: pg.PoolClient;
    try { client = await pool.connect(); }
    catch {
      log({ requestId: res.locals.requestId, route: '/api/v1/source-events/batches', failure: 'database_connection_unavailable' });
      res.status(503).json({ error: 'ingestion_unavailable', requestId: res.locals.requestId });
      return;
    }
    try {
      const { batchId, counts, outcomes: committedOutcomes } = await persistBatch(client, body.data.sourceManifestId, res.locals.requestId, valid, outcomes, archiveHashes);
      res.locals.batchId = batchId;
      res.locals.counts = counts;
      res.status(200).json({ requestId: res.locals.requestId, batchId, hashContract: HASH_CONTRACT, counts, outcomes: committedOutcomes });
    } catch {
      log({ requestId: res.locals.requestId, route: '/api/v1/source-events/batches', failure: 'database_or_archive_transaction' });
      res.status(503).json({ error: 'ingestion_unavailable', requestId: res.locals.requestId });
    } finally { client.release(); }
  };
}

