import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
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
  revision: z.object({ git: z.null(), reason: z.string(), sourceSha256: z.string().length(64) }),
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
const historicalRoot = '/Users/harsh/Projects/Smart-Water-Sub-Meter-Platform';
const currentRoot = realpathSync('.');
const historicalPath = (path: string) => `${historicalRoot}/${path}`;
function relocatedInput(path: string) {
  if (!path.startsWith(`${historicalRoot}/`)) throw new Error(`Saved benchmark input is outside its recorded repository: ${path}`);
  const candidate = realpathSync(resolve(currentRoot, path.slice(historicalRoot.length + 1)));
  const withinRoot = relative(currentRoot, candidate);
  if (withinRoot === '..' || withinRoot.startsWith(`..${sep}`)) throw new Error(`Saved benchmark input escapes repository: ${path}`);
  return candidate;
}

if (baseline.mode !== 'baseline' || final.mode !== 'final') throw new Error('Benchmark mode labels do not match result files');
if (baseline.execution.modulePath !== historicalPath('tools/bench/baseline-source/ingest.ts') || final.execution.modulePath !== historicalPath('apps/server/src/ingest.ts')) throw new Error('Benchmark executed the wrong historical ingestion module');
const finalSnapshots = [
  { path: 'tools/bench/final-source-stage2-modular/ingest.ts', label: 'preserved Stage 2 modular source' },
  { path: 'tools/bench/final-source-stage2/ingest.ts', label: 'preserved Stage 2 pre-refactor source' }
] as const;
const finalSnapshot = finalSnapshots.find(snapshot => final.execution.moduleSha256 === sourceHash(snapshot.path));
if (baseline.execution.moduleSha256 !== sourceHash('tools/bench/baseline-source/ingest.ts') || !finalSnapshot) throw new Error('Saved benchmark source does not match its recorded hash');
if (baseline.revision.sourceSha256 !== baseline.execution.moduleSha256 || final.revision.sourceSha256 !== final.execution.moduleSha256) throw new Error('Saved benchmark revision does not match executed source');
if (baseline.execution.moduleSha256 === final.execution.moduleSha256 || baseline.execution.persistence !== 'single_insert_per_event' || final.execution.persistence !== 'batched_insert') throw new Error('Benchmark modes do not represent distinct persistence paths');
for (const key of ['source', 'scenario', 'machine', 'verifiedInputs', 'migrationVersions'] as const) {
  if (JSON.stringify(baseline[key]) !== JSON.stringify(final[key])) throw new Error(`Unmatched benchmark ${key}`);
}
for (const { path, sha256 } of baseline.verifiedInputs) {
  if (sourceHash(relocatedInput(path)) !== sha256) throw new Error(`Saved benchmark input changed: ${path}`);
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
const stage2 = [
  `# Results — Stage 2 historical ${finalSnapshot.path.includes('modular') ? 'modular' : 'pre-refactor'} local HTTP source-event comparison`,
  '',
  'The [original baseline](tools/bench/results/stage2-http-baseline.json) and [original final](tools/bench/results/stage2-http-final.json) both executed the same final module, so their 6.02× comparison is withdrawn. The [corrected pre-refactor baseline](tools/bench/results/stage2-http-baseline-repair-2026-10-28.json) and [corrected pre-refactor final](tools/bench/results/stage2-http-final-repair-2026-10-28.json) remain historical evidence. This report uses the [selected baseline](' + basePath + ') and [selected final](' + finalPath + ').',
  '',
  'These measurements were captured before the repository was renamed and before Stage 3/4 changed the server composer. The recorded absolute module and input paths are checked against the former repository root; pinned input hashes are checked against the corresponding files in this checkout. The exact measured final module is preserved as a source snapshot. The current `apps/server/src/ingest.ts` is not the measured source.',
  '',
  '| Metric, median (minimum–maximum across five measured runs) | Frozen single-insert baseline | Batched final |',
  '|---|---:|---:|',
  `| Throughput, events/s | ${cell(baseline.acrossRun.throughputEventsPerSec)} | ${cell(final.acrossRun.throughputEventsPerSec)} |`,
  `| Request p50, ms | ${cell(baseline.acrossRun.p50RequestMs)} | ${cell(final.acrossRun.p50RequestMs)} |`,
  `| Request p95, ms | ${cell(baseline.acrossRun.p95RequestMs)} | ${cell(final.acrossRun.p95RequestMs)} |`,
  '',
  `Median throughput ratio: **${ratio.toFixed(2)}×** in this local matched scenario. Each mode used one warm-up and five measured runs of 10,000 published HSB rows, HTTP batches of ${baseline.scenario.batchSize}, and concurrency ${baseline.scenario.concurrency}. Each measured run accepted all 10,000. Separate replays classified 10,000 duplicates with zero new rows; each changed-key probe recorded one durable conflict. These are historical source-event imports, not live telemetry or coverage-certified billing volumes. Q-05's m³ unit inference remains open.`,
  '',
  `**Executed modules:** baseline [frozen source](tools/bench/baseline-source/ingest.ts), SHA-256 \`${baseline.execution.moduleSha256}\`; final [${finalSnapshot.label}](${finalSnapshot.path}), SHA-256 \`${final.execution.moduleSha256}\`. The raw JSON records each executed historical absolute module path, pinned adapter/profile/migration checksums, applied migrations, source DOI/version/archive and CSV checksums, scenario hash \`${baseline.scenario.hash}\`, hardware/software versions, per-request latencies, per-run results, and exact commands. [The report generator](tools/bench/report.ts) verifies historical paths, source hashes, matched inputs, scenario, machine metadata, and replay/conflict results. No Git commit existed when the measurements ran, so their raw files record a null Git revision; the source snapshots and hashes identify the executed implementations.`,
  '',
  'The measurements support only this local HTTP ingestion comparison and replay/conflict behavior. They do not establish hosted throughput, measured billable consumption, savings, or resident charges. Stage 4 deployed evidence is reported separately below.',
  ''
].join('\n');
const existing = readFileSync('RESULTS.md', 'utf8');
const tailAnchor = '\n## Stage 3 local billing query probe\n';
const tailStart = existing.indexOf(tailAnchor);
if (tailStart < 0) throw new Error('RESULTS.md is missing its Stage 3/4 evidence; refusing to replace it');
writeFileSync('RESULTS.md', `${stage2}\n${existing.slice(tailStart + 1)}`);
console.log(`Wrote RESULTS.md from selected raw results; throughput ratio ${ratio.toFixed(2)}x`);

