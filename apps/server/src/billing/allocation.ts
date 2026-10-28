import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const fixtureSchema = z.object({
  provenance: z.literal('injected_test_fixture'), societyTimezone: z.string(),
  periodStartLocal: z.iso.datetime({ offset: true }), periodEndLocal: z.iso.datetime({ offset: true }),
  intervalMinutes: z.number().int().positive(), physicalMainMeter: z.null(),
  flats: z.array(z.object({ id: z.string().min(1), volumeMlByInterval: z.array(decimal) })).min(1)
});
export type Fixture = z.infer<typeof fixtureSchema>;
export type Invoice = { variableMinor: string; fixedMinor: string; totalMinor: string; invoiceVolumeMl: string | null };
export type Statement = { flatId: string; volumeMl: string; variableMinor: string; sharedMinor: string; fixedMinor: string; totalMinor: string; fixtureProvenance: 'fictional_billing_fixture'; invoiceProvenance: 'illustrative_invoice' };

export function loadFixture(path = 'tools/fault-fixtures/billing-demo.json'): Fixture {
  return validateFixture(JSON.parse(readFileSync(path, 'utf8')));
}
function localAt(utcMs: number, zone: string): string {
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const parts = Object.fromEntries(f.formatToParts(new Date(utcMs)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
export function validateFixture(raw: unknown): Fixture {
  const fixture = fixtureSchema.parse(raw);
  const start = Date.parse(fixture.periodStartLocal), end = Date.parse(fixture.periodEndLocal);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
      localAt(start, fixture.societyTimezone) !== fixture.periodStartLocal.slice(0, 19) ||
      localAt(end, fixture.societyTimezone) !== fixture.periodEndLocal.slice(0, 19) ||
      (end - start) % (fixture.intervalMinutes * 60_000) !== 0) throw new Error('invalid_fixture_period');
  const count = (end - start) / (fixture.intervalMinutes * 60_000);
  const ids = new Set<string>();
  for (const flat of fixture.flats) {
    if (ids.has(flat.id)) throw new Error('ambiguous_flat_mapping');
    ids.add(flat.id);
    if (flat.volumeMlByInterval.length !== count) throw new Error('incomplete_fixture_coverage');
    flat.volumeMlByInterval.forEach(value => { if (!decimal.safeParse(value).success) throw new Error('invalid_fixture_volume'); });
  }
  return fixture;
}
export function allocateLargestRemainder(amount: bigint, weights: readonly { id: string; weight: bigint }[]): Map<string, bigint> {
  if (amount < 0n || weights.length === 0 || weights.some(w => w.weight < 0n) || new Set(weights.map(w => w.id)).size !== weights.length) throw new Error('invalid_allocation');
  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0n);
  if (amount > 0n && totalWeight === 0n) throw new Error('zero_allocatable_volume');
  const result = new Map(weights.map(w => [w.id, totalWeight === 0n ? 0n : amount * w.weight / totalWeight]));
  let left = amount - [...result.values()].reduce((sum, value) => sum + value, 0n);
  const order = [...weights].sort((a, b) => {
    const ar = totalWeight === 0n ? 0n : amount * a.weight % totalWeight;
    const br = totalWeight === 0n ? 0n : amount * b.weight % totalWeight;
    return ar === br ? a.id.localeCompare(b.id, 'en') : ar > br ? -1 : 1;
  });
  for (const item of order) { if (left-- <= 0n) break; result.set(item.id, result.get(item.id)! + 1n); }
  return result;
}
export function calculate(fixture: Fixture, invoice: Invoice): Statement[] {
  const validated = validateFixture(fixture);
  for (const value of [invoice.variableMinor, invoice.fixedMinor, invoice.totalMinor]) if (!decimal.safeParse(value).success) throw new Error('invalid_invoice');
  if (invoice.invoiceVolumeMl !== null && !decimal.safeParse(invoice.invoiceVolumeMl).success) throw new Error('invalid_invoice_volume');
  const variable = BigInt(invoice.variableMinor), fixed = BigInt(invoice.fixedMinor), total = BigInt(invoice.totalMinor);
  if (variable + fixed !== total) throw new Error('invoice_reconciliation_failed');
  const volumes = validated.flats.map(f => ({ id: f.id, weight: f.volumeMlByInterval.reduce((sum, v) => sum + BigInt(v), 0n) }));
  const totalVolume = volumes.reduce((sum, v) => sum + v.weight, 0n);
  if (invoice.invoiceVolumeMl !== null && BigInt(invoice.invoiceVolumeMl) !== totalVolume) throw new Error('invoice_volume_mismatch');
  const variableParts = allocateLargestRemainder(variable, volumes);
  const fixedParts = allocateLargestRemainder(fixed, volumes.map(v => ({ id: v.id, weight: 1n })));
  const statements = volumes.map(v => {
    const variableMinor = variableParts.get(v.id)!, fixedMinor = fixedParts.get(v.id)!;
    return { flatId: v.id, volumeMl: v.weight.toString(), variableMinor: variableMinor.toString(), sharedMinor: '0', fixedMinor: fixedMinor.toString(), totalMinor: (variableMinor + fixedMinor).toString(), fixtureProvenance: 'fictional_billing_fixture' as const, invoiceProvenance: 'illustrative_invoice' as const };
  });
  if (statements.reduce((sum, s) => sum + BigInt(s.totalMinor), 0n) !== total) throw new Error('statement_reconciliation_failed');
  return statements;
}
export function previewHash(fixture: Fixture, invoice: Invoice, billVersion: number, statements: Statement[]): string {
  return createHash('sha256').update(JSON.stringify({ fixture, invoice, billVersion, allocationRule: 'largest-remainder-v1', statements })).digest('hex');
}
