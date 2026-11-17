import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import { publicDemoRoutes } from './public-demo.js';

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use('/api/v1/demo', publicDemoRoutes());
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  base = 'http://127.0.0.1:' + address.port;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

describe('public fictional billing preview', () => {
  it('needs no token, reconciles exactly, and performs no write', async () => {
    const response = await fetch(base + '/api/v1/demo/preview');
    const result = await response.json() as {
      provenance: string; persistence: string;
      invoice: { totalMinor: string };
      statements: { flatId: string; totalMinor: string }[];
    };
    expect(response.status).toBe(200);
    expect(result).toMatchObject({ provenance: 'fictional_billing_fixture', persistence: 'none', invoice: { totalMinor: '700' } });
    expect(result.statements.map(item => [item.flatId, item.totalMinor])).toEqual([['DEMO_A', '400'], ['DEMO_B', '300']]);
    expect(result.statements.reduce((sum, item) => sum + BigInt(item.totalMinor), 0n)).toBe(700n);
  });
  it('allocates odd paise deterministically and rejects malformed values', async () => {
    const response = await fetch(base + '/api/v1/demo/preview?variableMinor=901&fixedMinor=99');
    const result = await response.json() as { statements: { totalMinor: string }[] };
    expect(result.statements.map(item => item.totalMinor)).toEqual(['591', '409']);
    expect((await fetch(base + '/api/v1/demo/preview?variableMinor=-1')).status).toBe(400);
    expect((await fetch(base + '/api/v1/demo/preview?variableMinor=1&extra=1')).status).toBe(400);
  });
});
