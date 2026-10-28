import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const modeSchema = z.enum(['baseline', 'final']);
export type BenchmarkMode = z.infer<typeof modeSchema>;
const modulePaths = {
  baseline: 'tools/bench/baseline-source/ingest.ts',
  final: 'apps/server/src/ingest.ts'
} as const;
const baselineSha256 = '449dabf09ffc3363a1184e43f20ee4de33c1e9511a35ceb6a471e09405bdf715';
const pinnedInputs = [
  { path: 'tools/bench/baseline-source/hsb.ts', sha256: 'd24a21eac14e0dc5fd7a1b629de1850834d4cffbede50b69866432b609df4433' },
  { path: 'packages/shared/src/hsb.ts', sha256: 'd24a21eac14e0dc5fd7a1b629de1850834d4cffbede50b69866432b609df4433' },
  { path: 'packages/shared/dist/hsb.js', sha256: '29229f8058cc216bed6f637e0179c60707d7393c3bd73bc303f18210680d9942' },
  { path: 'packages/shared/src/index.ts', sha256: 'bc9baf252a8f549a9bbf111ea56245b2301eafbc0c7591500172e89b3a450ee4' },
  { path: 'packages/db/migrations/001_source_events.sql', sha256: '21059cebbe5e212e5ba45ca0e697d8c7cca2288df555910ed6df3361dcb8660c' },
  { path: 'packages/db/migrations/002_limit_future_grants.sql', sha256: '9c65baa4523fccebca3c399362585404071912a5a2bed4f9749c67e349838b2f' },
  { path: 'packages/db/migrations/003_ingestion_batches.sql', sha256: '2d40846860c16d54d417fe5b761d285f7d35783508891fd7824378e1ca8712dc' },
  { path: 'tools/bench/baseline-source/003_ingestion_batches.sql', sha256: '2d40846860c16d54d417fe5b761d285f7d35783508891fd7824378e1ca8712dc' },
  { path: 'docs/data/hsb-profile.json', sha256: 'eb5f00279db07f77a02500265f2768887e32280fa1eb25d1bf71c8afc789674f' },
  { path: 'tools/bench/final-source-stage2/ingest.ts', sha256: '64707f3abc1b2ea1cebf3e07b131f511aa163fe521df380f037ba4c3b56505d2' },
  { path: 'apps/server/src/routes/source-events.ts', sha256: 'a3729491f858bdded15628437212952ded28b39722442b5f7160111d65665d76' },
  { path: 'apps/server/src/controllers/source-events.ts', sha256: '7cdcfc0cd1aca5336ecdaa081a9ee1ab2fe8b29760869cae746b0bf05118dab0' },
  { path: 'apps/server/src/services/persist-batch.ts', sha256: 'a110d4def0cebbf2b26d28929add58f3147d63567900bc17996f82ad4ab8c12e' }
] as const;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function verifyBenchmarkInputs() {
  const inputs = pinnedInputs.map(({ path, sha256 }) => {
    const actual = hash(readFileSync(path));
    if (actual !== sha256) throw new Error(`Benchmark input changed: ${path}`);
    return { path: realpathSync(path), sha256: actual };
  });
  return inputs;
}

export function assertModeSelection(mode: BenchmarkMode, actualPath: string, source: string) {
  const expectedPath = realpathSync(modulePaths[mode]);
  if (realpathSync(actualPath) !== expectedPath) throw new Error(`Mode ${mode} selected the wrong ingestion module`);
  const sourceSha256 = hash(Buffer.from(source));
  if (mode === 'baseline') {
    if (sourceSha256 !== baselineSha256 || !source.includes('This baseline intentionally executes one INSERT per valid event.')) throw new Error('Frozen baseline source changed');
  } else if (!source.includes("from './routes/source-events.js'") || !source.includes('sourceEventRoutes({') || sourceSha256 === baselineSha256) {
    throw new Error('Final mode did not select the batched implementation');
  }
  return sourceSha256;
}

export async function loadBenchmarkModule(rawMode: string) {
  const mode = modeSchema.parse(rawMode);
  const path = realpathSync(resolve(modulePaths[mode]));
  const sha256 = assertModeSelection(mode, path, readFileSync(path, 'utf8'));
  const loaded = await import(pathToFileURL(path).href) as { createIngestApp?: typeof import('../../apps/server/src/ingest.js').createIngestApp };
  if (typeof loaded.createIngestApp !== 'function') throw new Error(`No createIngestApp export in ${path}`);
  return { mode, path, sha256, createIngestApp: loaded.createIngestApp };
}
