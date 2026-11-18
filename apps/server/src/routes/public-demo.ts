import { Router } from 'express';
import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import { adaptRow, canonicalParsedRowHash, classifyReplay, type SensorMap } from '@water/shared/hsb';
import { z } from 'zod';
import { calculate, loadFixture } from '../billing/allocation.js';

const amount = z.string().regex(/^(0|[1-9][0-9]{0,8})$/);
const querySchema = z.strictObject({
  variableMinor: amount.default('500'),
  fixedMinor: amount.default('200')
});

const firstSampleLine = 2;
const lastSampleLine = 1001;

function changedValue(value: string): string {
  const [whole, fractional] = value.split('.');
  const thousandths = BigInt(whole!) * 1000n + BigInt(fractional!.padEnd(3, '0')) + 1n;
  return `${thousandths / 1000n}.${String(thousandths % 1000n).padStart(3, '0')}`;
}

/** Public source inspection and fictional billing preview; neither persists data. */
export async function publicDemoRoutes(config: { fixturePath: string | undefined; csvPath: string; sensorMap: SensorMap; archiveHashes: Map<number, string> }) {
  const router = Router();
  const fixture = loadFixture(config.fixturePath);
  const sampleRows = new Map<number, Record<string, string>>();
  for await (const item of createReadStream(config.csvPath).pipe(parse({ columns: true, delimiter: ';', info: true, to_line: lastSampleLine, bom: true }))) {
    const line = item.info.lines as number;
    const row = item.record as Record<string, string>;
    if (line >= firstSampleLine && line <= lastSampleLine) {
      if (canonicalParsedRowHash(row) !== config.archiveHashes.get(line)) throw new Error('Unverified public source sample');
      sampleRows.set(line, row);
    }
  }
  if (sampleRows.size !== lastSampleLine - firstSampleLine + 1) throw new Error('Incomplete public source sample');
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
    const parsed = z.strictObject({
      scenario: z.enum(['new', 'replay', 'changed']).default('new'),
      line: z.coerce.number().int().min(firstSampleLine).max(lastSampleLine).default(firstSampleLine)
    }).safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: 'invalid_demo_scenario' }); return; }
    const scenario = parsed.data.scenario;
    const line = parsed.data.line;
    const trustedRow = sampleRows.get(line)!;
    const trustedHash = config.archiveHashes.get(line)!;
    const incomingRow = scenario === 'changed' ? { ...trustedRow, value: changedValue(trustedRow.value!) } : { ...trustedRow };
    const event = adaptRow(incomingRow, line, config.sensorMap);
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
      source: { datasetDoi: '10.5281/zenodo.22076411', csvLine: line, sourceRowKey: event.sourceRowKey },
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
