import { Router } from 'express';
import { z } from 'zod';
import { calculate, loadFixture } from '../billing/allocation.js';

const amount = z.string().regex(/^(0|[1-9][0-9]{0,8})$/);
const querySchema = z.strictObject({
  variableMinor: amount.default('500'),
  fixedMinor: amount.default('200')
});

/** Public, stateless billing sample. It never reads or writes resident data. */
export function publicDemoRoutes(fixturePath?: string) {
  const router = Router();
  const fixture = loadFixture(fixturePath);
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

  return router;
}
