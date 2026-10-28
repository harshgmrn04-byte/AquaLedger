import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

const metric = z.object({ median: z.number(), min: z.number(), max: z.number() });
const counts = z.object({ accepted: z.number(), duplicate: z.number(), conflict: z.number(), rejected: z.number() });
const run = z.object({ counts, requestLatenciesMs: z.array(z.number()).length(20), throughputEventsPerSec: z.number(), p50RequestMs: z.number(), p95RequestMs: z.number() });
const resultSchema = z.object({
  mode: z.enum(['baseline', 'final']),
  execution: z.object({ modulePath: z.string(), moduleSha256: z.string().length(64), persistence: z.string() }),
  verifiedInputs: z.array(z.object({ path: z.string(), sha256: z.string().length(64) })),
  migrationVersions: z.array(z.string()),
  source: z.object({ doi: z.string(), version: z.string(), archiveSha256: z.string(), csvSha256: z.string(), adapterVersion: z.string() }),
  scenario: z.object({ hash: z.string(), rows: z.number(), batchSize: z.number(), concurrency: z.number() }),
  machine: z.object({ cpu: z.string().optional(), logicalCpus: z.number(), ramBytes: z.number(), os: z.string(), node: z.string(), postgresql: z.string() }),
  warmup: run,
  runs: z.array(run).length(5),
  acrossRun: z.object({ throughputEventsPerSec: metric, p50RequestMs: metric, p95RequestMs: metric }),
  replay: run.extend({ rowCountAfter: z.string() }),
  changedKey: z.object({ response: z.object({ counts }), durableConflictCount: z.string() })
});

const basePath = process.argv[2] ?? 'tools/bench/results/stage2-http-baseline-modular-2026-10-28.json';
const finalPath = process.argv[3] ?? 'tools/bench/results/stage2-http-final-modular-2026-10-28.json';
const baseline = resultSchema.parse(JSON.parse(readFileSync(basePath, 'utf8')));
const final = resultSchema.parse(JSON.parse(readFileSync(finalPath, 'utf8')));
const sourceHash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

if (baseline.mode !== 'baseline' || final.mode !== 'final') throw new Error('Benchmark mode labels do not match result files');
if (baseline.execution.modulePath !== realpathSync('tools/bench/baseline-source/ingest.ts') || final.execution.modulePath !== realpathSync('apps/server/src/ingest.ts')) throw new Error('Benchmark executed the wrong ingestion module');
const currentFinal = final.execution.moduleSha256 === sourceHash('apps/server/src/ingest.ts');
const preservedFinal = final.execution.moduleSha256 === sourceHash('tools/bench/final-source-stage2/ingest.ts');
if (baseline.execution.moduleSha256 !== sourceHash('tools/bench/baseline-source/ingest.ts') || (!currentFinal && !preservedFinal)) throw new Error('Saved benchmark source does not match its recorded hash');
const finalSourcePath = currentFinal ? 'apps/server/src/ingest.ts' : 'tools/bench/final-source-stage2/ingest.ts';
if (baseline.execution.moduleSha256 === final.execution.moduleSha256 || baseline.execution.persistence !== 'single_insert_per_event' || final.execution.persistence !== 'batched_insert') throw new Error('Benchmark modes do not represent distinct persistence paths');
for (const key of ['source', 'scenario', 'machine', 'verifiedInputs', 'migrationVersions'] as const) {
  if (JSON.stringify(baseline[key]) !== JSON.stringify(final[key])) throw new Error(`Unmatched benchmark ${key}`);
}
for (const { path, sha256 } of baseline.verifiedInputs) {
  if (sourceHash(path) !== sha256) throw new Error(`Saved benchmark input changed: ${path}`);
}
for (const result of [baseline, final]) {
  for (const observed of [result.warmup, ...result.runs]) {
    if (observed.counts.accepted !== 10000 || observed.counts.duplicate !== 0 || observed.counts.conflict !== 0 || observed.counts.rejected !== 0) throw new Error(`Invalid ${result.mode} import run`);
  }
  if (result.replay.counts.duplicate !== 10000 || result.replay.counts.accepted !== 0 || result.replay.rowCountAfter !== '10000' || result.changedKey.response.counts.conflict !== 1 || result.changedKey.durableConflictCount !== '1') throw new Error(`Invalid ${result.mode} replay/conflict check`);
}

const fmt = (v: number) => v.toFixed(1);
const cell = (m: z.infer<typeof metric>) => `${fmt(m.median)} (${fmt(m.min)}–${fmt(m.max)})`;
const ratio = final.acrossRun.throughputEventsPerSec.median / baseline.acrossRun.throughputEventsPerSec.median;
const text = [
  `# Results — Stage 2 ${currentFinal ? 'modular' : 'preserved pre-refactor'} local HTTP source-event comparison`,
  '',
  'The [original baseline](tools/bench/results/stage2-http-baseline.json) and [original final](tools/bench/results/stage2-http-final.json) both executed the same final module, so their 6.02× comparison is withdrawn. The [corrected pre-refactor baseline](tools/bench/results/stage2-http-baseline-repair-2026-10-28.json) and [corrected pre-refactor final](tools/bench/results/stage2-http-final-repair-2026-10-28.json) remain historical evidence. This report uses the [selected baseline](' + basePath + ') and [selected final](' + finalPath + ').',
  '',
  '| Metric, median (minimum–maximum across five measured runs) | Frozen single-insert baseline | Batched final |',
  '|---|---:|---:|',
  `| Throughput, events/s | ${cell(baseline.acrossRun.throughputEventsPerSec)} | ${cell(final.acrossRun.throughputEventsPerSec)} |`,
  `| Request p50, ms | ${cell(baseline.acrossRun.p50RequestMs)} | ${cell(final.acrossRun.p50RequestMs)} |`,
  `| Request p95, ms | ${cell(baseline.acrossRun.p95RequestMs)} | ${cell(final.acrossRun.p95RequestMs)} |`,
  '',
  `Median throughput ratio: **${ratio.toFixed(2)}×** in this local matched scenario. Each mode used one warm-up and five measured runs of 10,000 published HSB rows, HTTP batches of ${baseline.scenario.batchSize}, and concurrency ${baseline.scenario.concurrency}. Each measured run accepted all 10,000. Separate replays classified 10,000 duplicates with zero new rows; each changed-key probe recorded one durable conflict. These are historical source-event imports, not live telemetry or coverage-certified billing volumes. Q-05's m³ unit inference remains open.`,
  '',
  `**Executed modules:** baseline [frozen source](tools/bench/baseline-source/ingest.ts), SHA-256 \`${baseline.execution.moduleSha256}\`; final [${currentFinal ? 'current modular source' : 'preserved Stage 2 source'}](${finalSourcePath}), SHA-256 \`${final.execution.moduleSha256}\`. The raw JSON records each executed absolute module path, pinned adapter/profile/migration checksums, applied migrations, source DOI/version/archive and CSV checksums, scenario hash \`${baseline.scenario.hash}\`, hardware/software versions, per-request latencies, per-run results, and exact commands. [The report generator](tools/bench/report.ts) verifies source hashes, matched inputs, scenario, machine metadata, and replay/conflict results. The repository has no commit; neither run has a Git revision.`,
  '',
  'The measurements support only this local HTTP ingestion comparison and replay/conflict behavior. They do not establish hosted throughput, measured billable consumption, savings, or resident charges. GitHub Actions has no run yet; CI is not green.',
  ''
].join('\n');
writeFileSync('RESULTS.md', text);
console.log(`Wrote RESULTS.md from selected raw results; throughput ratio ${ratio.toFixed(2)}x`);

