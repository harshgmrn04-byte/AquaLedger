import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { adaptRow, canonicalParsedRowHash, classifyReplay, type SensorMap } from '@water/shared/hsb';
import { z } from 'zod';
import { calculate, loadFixture } from '../billing/allocation.js';

const amount = z.string().regex(/^(0|[1-9][0-9]{0,8})$/);
const querySchema = z.strictObject({
  variableMinor: amount.default('500'),
  fixedMinor: amount.default('200')
});

/** Public source inspection and fictional billing preview; neither persists data. */
export function publicDemoRoutes(config: { fixturePath: string | undefined; csvPath: string; sensorMap: SensorMap; archiveHashes: Map<number, string> }) {
  const router = Router();
  const fixture = loadFixture(config.fixturePath);
  const sample = parse(readFileSync(config.csvPath, 'utf8'), { columns: true, delimiter: ';', to_line: 2, bom: true }) as Record<string, string>[];
  const trustedRow = sample[0];
  const trustedHash = config.archiveHashes.get(2);
  if (!trustedRow || !trustedHash || canonicalParsedRowHash(trustedRow) !== trustedHash) throw new Error('Unverified public source sample');
  const totalVolumeMl = fixture.flats.reduce(
    (sum, flat) => sum + flat.volumeMlByInterval.reduce((flatSum, value) => flatSum + BigInt(value), 0n),
    0n
  );

  router.get('/preview', (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: 'invalid_demo_amount' }); return; }

    const invoice = {
      invoiceVolumeMl: totalVolumeMl.toString(),
      variableMinor: parsed.data.variableMinor,
      fixedMinor: parsed.data.fixedMinor,
      totalMinor: (BigInt(parsed.data.variableMinor) + BigInt(parsed.data.fixedMinor)).toString()
    };
    const statements = calculate(fixture, invoice);
    res.json({
      provenance: 'fictional_billing_fixture',
      persistence: 'none',
      period: { start: fixture.periodStartLocal, end: fixture.periodEndLocal, timezone: fixture.societyTimezone },
      invoice,
      statements
    });
  });

  // Stateless inspection of the pinned source adapter. No ingestion credential,
  // database query, event insertion, or resident information is involved.
  router.get('/event-check', (req, res) => {
    const parsed = z.strictObject({ scenario: z.enum(['new', 'replay', 'changed']).default('new') }).safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: 'invalid_demo_scenario' }); return; }
    const scenario = parsed.data.scenario;
    const incomingRow = scenario === 'changed' ? { ...trustedRow, value: '0.02' } : { ...trustedRow };
    const event = adaptRow(incomingRow, 2, config.sensorMap);
    const incomingHash = event.rowSha256;
    const archiveMatch = incomingHash === trustedHash;
    const priorHash = scenario === 'new' ? undefined : trustedHash;
    const replayClassification = classifyReplay(priorHash, incomingHash);
    const outcome = !archiveMatch && !priorHash ? 'rejected' : replayClassification;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      provenance: scenario === 'changed' ? 'injected_change_to_published_row' : 'published_hsb_sample',
      mode: 'stateless_dry_run',
      persistence: 'none',
      scenario,
      source: { datasetDoi: '10.5281/zenodo.22076411', csvLine: 2, sourceRowKey: event.sourceRowKey },
      normalized: { sensorId: event.sourceSensorId, apartment: event.apartment, timestamp: event.timestamp, volumeMl: event.volumeMl, channel: event.channel },
      checks: { sensorMapping: 'pass', utcTimestamp: 'pass', positiveVolume: 'pass', pinnedArchiveHash: archiveMatch ? 'pass' : 'fail' },
      comparison: { priorState: priorHash ? 'pinned_row_assumed_present' : 'no_prior_row_assumed', priorHashPrefix: priorHash?.slice(0, 12) ?? null, incomingHashPrefix: incomingHash.slice(0, 12) },
      outcome,
      reasonCode: outcome === 'accepted' ? 'new_verified_row' : outcome === 'duplicate' ? 'same_canonical_row' : outcome === 'conflict' ? 'changed_source_row_key' : 'archive_row_mismatch',
      coverageCertified: false
    });
  });

  return router;
}
