import type pg from 'pg';
import type { Event, Outcome } from '../schemas/ingestion.js';

export type ValidEvent = { index: number; event: Event };

export async function persistBatch(
  client: pg.PoolClient,
  manifestId: string,
  requestId: string,
  valid: ValidEvent[],
  outcomes: Outcome[],
  archiveHashes: Map<number, string>
) {
  try {
    await client.query('BEGIN');
    const conflicts: { key: string; existing: string; incoming: string }[] = [];
    const mismatchKeys = [...new Set(valid.filter(x => archiveHashes.get(Number(x.event.sourceRowKey.slice(4))) !== x.event.rowSha256).map(x => x.event.sourceRowKey))];
    const preexistingRows = mismatchKeys.length ? await client.query<{ source_row_key: string; row_sha256: string }>(
      'SELECT source_row_key,row_sha256 FROM app.source_events WHERE source_manifest_id=$1 AND source_row_key=ANY($2::text[])',
      [manifestId, mismatchKeys]
    ) : { rows: [] };
    const preexisting = new Map(preexistingRows.rows.map(row => [row.source_row_key, row.row_sha256]));
    const candidates = new Map<string, Event>();
    for (const { event } of valid) {
      if (archiveHashes.get(Number(event.sourceRowKey.slice(4))) === event.rowSha256 && !candidates.has(event.sourceRowKey)) candidates.set(event.sourceRowKey, event);
    }
    const values: unknown[] = [];
    const placeholders: string[] = [];
    for (const event of candidates.values()) {
      const offset = values.length;
      values.push(manifestId, event.sourceRowKey, event.sourceSensorId, event.apartment, event.fixture, event.channel, event.timestamp, event.volumeMl, event.rowSha256);
      placeholders.push(`(${Array.from({ length: 9 }, (_, j) => `$${offset + j + 1}`).join(',')})`);
    }
    const insertedKeys = new Set<string>();
    if (values.length) {
      const inserted = await client.query<{ source_row_key: string }>(
        `INSERT INTO app.source_events(source_manifest_id,source_row_key,source_sensor_id,apartment,fixture,channel,event_at,volume_ml,row_sha256)
         VALUES ${placeholders.join(',')} ON CONFLICT DO NOTHING RETURNING source_row_key`, values
      );
      for (const row of inserted.rows) insertedKeys.add(row.source_row_key);
    }
    const keys = [...new Set(valid.map(x => x.event.sourceRowKey))];
    const existing = keys.length ? await client.query<{ source_row_key: string; row_sha256: string }>(
      'SELECT source_row_key,row_sha256 FROM app.source_events WHERE source_manifest_id=$1 AND source_row_key=ANY($2::text[])',
      [manifestId, keys]
    ) : { rows: [] };
    const stored = new Map(existing.rows.map(row => [row.source_row_key, row.row_sha256]));
    const firstAccepted = new Set<string>();
    for (const { index, event } of valid) {
      const prior = stored.get(event.sourceRowKey);
      if (archiveHashes.get(Number(event.sourceRowKey.slice(4))) !== event.rowSha256) {
        const conflictPrior = firstAccepted.has(event.sourceRowKey) ? prior : preexisting.get(event.sourceRowKey);
        if (conflictPrior) { outcomes.push({ index, status: 'conflict', reasonCode: 'changed_source_row_key' }); conflicts.push({ key: event.sourceRowKey, existing: conflictPrior, incoming: event.rowSha256 }); }
        else outcomes.push({ index, status: 'rejected', reasonCode: 'archive_row_mismatch' });
        continue;
      }
      if (insertedKeys.has(event.sourceRowKey) && !firstAccepted.has(event.sourceRowKey)) {
        firstAccepted.add(event.sourceRowKey);
        outcomes.push({ index, status: 'accepted', reasonCode: 'inserted' });
        continue;
      }
      if (prior === event.rowSha256) outcomes.push({ index, status: 'duplicate', reasonCode: 'same_canonical_row' });
      else if (prior) { outcomes.push({ index, status: 'conflict', reasonCode: 'changed_source_row_key' }); conflicts.push({ key: event.sourceRowKey, existing: prior, incoming: event.rowSha256 }); }
      else throw new Error('missing_conflict_row');
    }
    const count = (status: Outcome['status']) => outcomes.filter(x => x.status === status).length;
    const batch = await client.query<{ id: string }>(
      'INSERT INTO app.source_event_batches(source_manifest_id,request_id,accepted_count,duplicate_count,conflict_count,rejected_count) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [manifestId, requestId, count('accepted'), count('duplicate'), count('conflict'), count('rejected')]
    );
    const batchId = batch.rows[0]!.id;
    for (const conflict of conflicts) await client.query('INSERT INTO app.source_event_conflicts(source_manifest_id,source_row_key,existing_row_sha256,incoming_row_sha256,batch_id) VALUES ($1,$2,$3,$4,$5)', [manifestId, conflict.key, conflict.existing, conflict.incoming, batchId]);
    await client.query('COMMIT');
    outcomes.sort((a, b) => a.index - b.index);
    const counts = { accepted: count('accepted'), duplicate: count('duplicate'), conflict: count('conflict'), rejected: count('rejected') };
    return { batchId, counts, outcomes };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

