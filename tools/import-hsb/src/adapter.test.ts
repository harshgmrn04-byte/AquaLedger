import { describe, expect, it } from 'vitest';
import { adaptRow, assessBillingCoverage, classifyReplay, convertInferredCubicMetresToMl } from './adapter.js';

const row = { timestamp: '2019-12-31 00:00:00', date: '2019-12-31', hour: '0', day_of_week: '1', day_name: 'Tuesday', month: '12', year: '2019', sensor_id: 'S0101', apartment: 'APT_005', cluster_name: 'CL_A', room_number: 'R025', room_type: 'Bathroom', type: 'cold water consumption', attached_to: 'Toilet', value: '0.01', aggregated_value: '84.024' };
const map = { S0101: [['APT_005', 'CL_A', 'R025', 'Bathroom', 'cold water consumption', 'Toilet']] };
describe('HSB event adapter', () => {
  it('preserves line identity and interprets UTC and inferred cubic-metre unit', () => {
    expect(adaptRow(row, 2, map)).toMatchObject({ sourceRowKey: 'csv:0000002', timestamp: '2019-12-31T00:00:00.000Z', volumeMl: '10000', apartment: 'APT_005' });
    expect(convertInferredCubicMetresToMl('0.001')).toBe('1000');
  });
  it('rejects changed fixture mapping and zero volumes', () => {
    expect(() => adaptRow({ ...row, apartment: 'APT_006' }, 2, map)).toThrow('sensor_mapping_mismatch');
    expect(() => adaptRow({ ...row, value: '0.000' }, 2, map)).toThrow('non_positive_volume');
  });
  it('distinguishes exact replay from changed content under the same line key', () => {
    expect(classifyReplay(undefined, 'a')).toBe('accepted');
    expect(classifyReplay('a', 'a')).toBe('duplicate');
    expect(classifyReplay('a', 'b')).toBe('conflict');
  });
  it('refuses a coverage claim from event-only rows', () => expect(assessBillingCoverage().eligible).toBe(false));
});
