import { z } from 'zod';
export const decimalInteger = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const observedEvent = z.object({
  sourceRowKey: z.string().min(1),
  sourceSensorId: z.string().regex(/^S[0-9]{4}$/),
  apartment: z.string().regex(/^APT_[0-9]{3}$/).nullable(),
  timestamp: z.iso.datetime({ offset: true }),
  volumeMl: decimalInteger,
  provenance: z.literal('observed_source_measurement')
});
export type ObservedEvent = z.infer<typeof observedEvent>;
