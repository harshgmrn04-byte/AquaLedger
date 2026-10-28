import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { parse } from 'csv-parse';
import { z } from 'zod';
import { canonicalParsedRowHash, type SensorMap } from '@water/shared/hsb';

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

export function loadSensorMap(profilePath: string): SensorMap {
  const profile = z.object({ sensor_mapping: z.record(z.string(), z.array(z.array(z.string()))) }).parse(JSON.parse(readFileSync(profilePath, 'utf8')));
  return profile.sensor_mapping;
}

