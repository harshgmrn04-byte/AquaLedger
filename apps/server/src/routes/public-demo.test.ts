import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import { loadArchive, loadSensorMap } from '../services/archive.js';
import { publicDemoRoutes } from './public-demo.js';

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  const csvPath = 'tools/import-hsb/fixtures/hsb-sample-1000.csv';
  app.use('/api/v1/demo', await publicDemoRoutes({ fixturePath: undefined, csvPath, sensorMap: loadSensorMap('docs/data/hsb-profile.json'), archiveHashes: await loadArchive(csvPath) }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  base = 'http://127.0.0.1:' + address.port;
});

describe('public source-event inspection', () => {
  it('runs the pinned adapter and distinguishes new, replay, and changed-key cases without writes', async () => {
    for (const [scenario, outcome, archiveHash] of [
      ['new', 'accepted', 'pass'], ['replay', 'duplicate', 'pass'], ['changed', 'conflict', 'fail']
    ]) {
      const response = await fetch(base + '/api/v1/demo/event-check?scenario=' + scenario);
      const result = await response.json() as Record<string, unknown>;
      expect(response.status).toBe(200);
      expect(result).toMatchObject({ mode: 'stateless_dry_run', persistence: 'none', scenario, outcome, checks: { pinnedArchiveHash: archiveHash }, coverageCertified: false });
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    const chosen = await fetch(base + '/api/v1/demo/event-check?scenario=changed&line=1001');
    expect(chosen.status).toBe(200);
    expect(await chosen.json()).toMatchObject({ source: { csvLine: 1001, sourceRowKey: 'csv:0001001' }, outcome: 'conflict', checks: { pinnedArchiveHash: 'fail' } });
    expect((await fetch(base + '/api/v1/demo/event-check?scenario=other')).status).toBe(400);
    expect((await fetch(base + '/api/v1/demo/event-check?line=1002')).status).toBe(400);
    expect((await fetch(base + '/api/v1/demo/event-check?line=0')).status).toBe(400);
  });
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
