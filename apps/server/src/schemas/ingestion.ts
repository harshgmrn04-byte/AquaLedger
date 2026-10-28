import { z } from 'zod';
import { adaptRow } from '@water/shared/hsb';

export const bodySchema = z.strictObject({
  sourceManifestId: z.string().regex(/^[1-9]\d*$/),
  events: z.array(z.unknown()).min(1).max(500)
});

export const eventSchema = z.strictObject({
  csvLine: z.number().int().min(2).max(652316),
  fields: z.record(z.string(), z.string())
});

export type Event = ReturnType<typeof adaptRow>;
export type Outcome = { index: number; status: 'accepted' | 'duplicate' | 'conflict' | 'rejected'; reasonCode: string };

