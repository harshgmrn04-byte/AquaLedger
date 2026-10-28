import { createHash } from 'node:crypto';
import { z } from 'zod';
import { observedEvent } from './index.js';

export const ADAPTER_VERSION = 'hsb-event-1.0.0';
export const HASH_CONTRACT = 'hsb-parsed-fields-json-v1';
export const SOURCE_COLUMNS = ['timestamp', 'date', 'hour', 'day_of_week', 'day_name', 'month', 'year', 'sensor_id', 'apartment', 'cluster_name', 'room_number', 'room_type', 'type', 'attached_to', 'value', 'aggregated_value'] as const;
export const ARCHIVE_SHA256 = 'ff766b30d05e65c2477fc929d56a112d5b0775619075daa2bd6dd687c57c7c89';
export const ARCHIVE_MD5 = '1db6a143f39da53710e63c6bb353d5b1';
const rowSchema = z.object({
  timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
  sensor_id: z.string().regex(/^S\d{4}$/),
  apartment: z.union([z.literal(''), z.string().regex(/^APT_\d{3}$/)]),
  cluster_name: z.string(), room_number: z.string(), room_type: z.string(),
  type: z.enum(['cold water consumption', 'hot water consumption']),
  attached_to: z.string().min(1),
  value: z.string().regex(/^\d+\.\d{1,3}$/),
  aggregated_value: z.string()
});
export type SourceRow = z.infer<typeof rowSchema>;
export type SensorMap = Record<string, string[][]>;

// v1 is SHA-256 of UTF-8 JSON.stringify of the parsed, string-valued CSV
// object in the published header order. This exactly matches Stage 1 hashes.
export function canonicalParsedRowHash(raw: Record<string, unknown>): string {
  const ordered: Record<string, string> = {};
  for (const column of SOURCE_COLUMNS) {
    if (typeof raw[column] !== 'string') throw new Error('invalid_source_field');
    ordered[column] = raw[column];
  }
  if (Object.keys(raw).length !== SOURCE_COLUMNS.length) throw new Error('invalid_source_field');
  return createHash('sha256').update(JSON.stringify(ordered), 'utf8').digest('hex');
}

export function convertInferredCubicMetresToMl(value: string): string {
  const match = /^(\d+)\.(\d{1,3})$/.exec(value);
  if (!match) throw new Error('invalid source value');
  return (BigInt(match[1]!) * 1_000_000n + BigInt(match[2]!.padEnd(3, '0')) * 1_000n).toString();
}

export function adaptRow(raw: unknown, csvLine: number, map: SensorMap) {
  const row = rowSchema.parse(raw);
  const tuple = [row.apartment, row.cluster_name, row.room_number, row.room_type, row.type, row.attached_to];
  if (!map[row.sensor_id]?.some(item => item.every((value, index) => value === tuple[index]))) throw new Error('sensor_mapping_mismatch');
  const date = new Date(row.timestamp.replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 19) !== row.timestamp.replace(' ', 'T')) throw new Error('invalid_utc_timestamp');
  const volumeMl = convertInferredCubicMetresToMl(row.value);
  if (BigInt(volumeMl) <= 0n) throw new Error('non_positive_volume');
  const event = observedEvent.parse({
    sourceRowKey: `csv:${String(csvLine).padStart(7, '0')}`,
    sourceSensorId: row.sensor_id,
    apartment: row.apartment || null,
    timestamp: date.toISOString(),
    volumeMl,
    provenance: 'observed_source_measurement'
  });
  return { ...event, fixture: row.attached_to, channel: row.type.startsWith('hot') ? 'hot' : 'cold', rowSha256: canonicalParsedRowHash(raw as Record<string, unknown>) };
}

export function classifyReplay(existingSha256: string | undefined, incomingSha256: string): 'accepted' | 'duplicate' | 'conflict' {
  return existingSha256 === undefined ? 'accepted' : existingSha256 === incomingSha256 ? 'duplicate' : 'conflict';
}

export function assessBillingCoverage(): { eligible: false; reason: string } {
  return { eligible: false, reason: 'Source is zero-filtered consumption events, not a complete interval heartbeat; absence does not prove zero use.' };
}
