import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { allocateLargestRemainder, calculate, loadFixture, validateFixture } from './allocation.js';

const fixture = loadFixture();
describe('fictional integer billing', () => {
  it('handles ties by flat ID and zero use without floating point', () => {
    expect([...allocateLargestRemainder(1n, [{ id: 'B', weight: 1n }, { id: 'A', weight: 1n }])]).toEqual([['B', 0n], ['A', 1n]]);
    const zero = validateFixture({ ...fixture, flats: fixture.flats.map(f => ({ ...f, volumeMlByInterval: Array(6).fill('0') })) });
    expect(calculate(zero, { invoiceVolumeMl: '0', variableMinor: '0', fixedMinor: '1', totalMinor: '1' }).map(s => s.totalMinor)).toEqual(['1', '0']);
    expect(() => calculate(zero, { invoiceVolumeMl: '0', variableMinor: '1', fixedMinor: '0', totalMinor: '1' })).toThrow('zero_allocatable_volume');
  });
  it('rejects missing, ambiguous, invalid timezone, and mismatched invoice inputs', () => {
    expect(() => validateFixture({ ...fixture, flats: [{ ...fixture.flats[0], volumeMlByInterval: ['1'] }] })).toThrow('incomplete_fixture_coverage');
    expect(() => validateFixture({ ...fixture, flats: [fixture.flats[0], fixture.flats[0]] })).toThrow('ambiguous_flat_mapping');
    expect(() => validateFixture({ ...fixture, periodStartLocal: '2026-01-01T00:00:00+00:00' })).toThrow('invalid_fixture_period');
    expect(() => calculate(fixture, { invoiceVolumeMl: '6000', variableMinor: '500', fixedMinor: '200', totalMinor: '700' })).toThrow('invoice_volume_mismatch');
    expect(() => calculate(fixture, { invoiceVolumeMl: '5000', variableMinor: '500', fixedMinor: '200', totalMinor: '701' })).toThrow('invoice_reconciliation_failed');
  });
  it('reconciles any bounded nonnegative allocation exactly', () => {
    fc.assert(fc.property(fc.array(fc.nat({ max: 100000 }), { minLength: 1, maxLength: 8 }), fc.nat({ max: 1000000 }), (weights, amount) => {
      const parts = allocateLargestRemainder(BigInt(amount), weights.map((weight, index) => ({ id: String(index), weight: BigInt(weight + 1) })));
      expect([...parts.values()].reduce((sum, value) => sum + value, 0n)).toBe(BigInt(amount));
    }));
  });
});
