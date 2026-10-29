import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { deterministicSelection, renderExplanation, validateSelection, type Facts } from '../../apps/server/src/billing/explanation.js';

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const frozenPath = 'tools/fault-fixtures/explanation-cases-v1.json';
const frozenBytes = readFileSync(frozenPath);
const frozen = JSON.parse(frozenBytes.toString()) as { cases: { facts: Facts }[] };
const evaluation = read<{ frozenCaseSha256: string; caseCount: number; provenance: string; template: { correct: number; total: number }; groq: { correct: number; accepted: number; total: number; rejectedOutputs: number } }>('tools/bench/results/stage4-explanations-v4.json');
const drill = read<{ databaseUnavailable: { health: { status: number }; readiness: { status: number } }; duplicateReplay: { replay: { counts: { duplicate: number; accepted: number } } }; stalePreview: { status: number }; groq: { rateLimited: { source: string }; timeout: { source: string } }; logs: unknown[] }>('docs/data/stage4-fault-drill.json');
const api = read<{ checks: { status: number; check: string }[]; dataApiBoundary: { status: number }[] }>('docs/data/stage4-deployed-api-smoke.json');
const site = read<{ checks: { status: number }[]; asset: { status: number; serverSecretEmbedded: boolean } }>('docs/data/stage4-deployed-site-smoke.json');
const web = read<{ checks: { role: string; expectedPanel: boolean; ownStatementOnly?: boolean }[] }>('docs/data/stage4-deployed-web-smoke.json');
const model = read<{ checks: { source?: string; fallbackReason?: string }[]; actualGroqCallsAvoided: number }>('docs/data/stage4-deployed-model-smoke.json');
const source = read<{ sourceSummary: { status: number; eventCount: string; coverageCertified: boolean }; corsPreflight: { status: number } }>('docs/data/stage4-deployed-source-smoke.json');
const resources = read<{ services: { type: string; plan: string | null; url: string }[]; ci: { conclusion: string; headSha: string }; initialDeployCommit: string; finalDeployCommit?: string }>('docs/data/stage4-release-resources.json');
const logs = read<{ requestedIds: number; matchedIds: number }>('docs/data/stage4-render-log-evidence.json');
const artifact = read<{ subset: { tracked: boolean; matchesHostedImportManifest: boolean }; forbiddenTracked: { env: boolean; rootArchive: boolean; raw: boolean }; dockerExcludes: { env: boolean; rootArchive: boolean; raw: boolean } }>('docs/data/stage4-artifact-exclusion.json');
const timings = read<{ cold: { status: number; elapsedMs: number; idleMinutes: number }; warm: { status: number; elapsedMs: number }; targetCommit: string }>('docs/data/stage4-deployed-timings.json');
const facts = frozen.cases[0]!.facts;
const selection = deterministicSelection(facts);
let numericRejected = false;
try { validateSelection({ ...selection, summary: 'The charge is twelve rupees' }, facts); } catch { numericRejected = true; }
const numbersRenderedOnlyByBackend = renderExplanation({ ...selection, summary: '₹999' }, facts).summary === selection.summary;
const checks = {
  frozenCasesAndEvaluation: frozen.cases.length >= 30 && evaluation.caseCount === frozen.cases.length && evaluation.frozenCaseSha256 === createHash('sha256').update(frozenBytes).digest('hex') && evaluation.provenance === 'fictional_billing_explanation_cases' && evaluation.template.correct === evaluation.template.total && evaluation.groq.accepted === evaluation.groq.total && evaluation.groq.correct === evaluation.groq.total && evaluation.groq.rejectedOutputs === 0,
  backendOnlyFigures: numericRejected && numbersRenderedOnlyByBackend,
  faultDiagnosis: drill.databaseUnavailable.health.status === 200 && drill.databaseUnavailable.readiness.status === 503 && drill.duplicateReplay.replay.counts.duplicate === 1 && drill.duplicateReplay.replay.counts.accepted === 0 && drill.stalePreview.status === 409 && drill.groq.rateLimited.source === 'fallback' && drill.groq.timeout.source === 'fallback' && drill.logs.length >= 4,
  dataApiDenied: api.dataApiBoundary.length === 2 && api.dataApiBoundary.every(item => item.status >= 400),
  deployedApiAndSite: api.checks.some(item => item.check === 'health' && item.status === 200) && api.checks.some(item => item.check === 'readiness' && item.status === 200) && site.checks.length >= 3 && site.checks.every(item => item.status === 200) && site.asset.status === 200 && !site.asset.serverSecretEmbedded,
  deployedAuthorizationAndModels: web.checks.length === 3 && web.checks.every(item => item.expectedPanel) && web.checks.filter(item => item.role.startsWith('resident')).every(item => item.ownStatementOnly) && model.checks.filter(item => item.source === 'groq').length >= 2 && model.actualGroqCallsAvoided >= 2 && model.checks.some(item => item.source === 'fallback' && item.fallbackReason === 'request_limit') && logs.matchedIds === logs.requestedIds,
  deployedHistoricalSubset: source.sourceSummary.status === 200 && source.sourceSummary.eventCount === '1000' && source.sourceSummary.coverageCertified === false && source.corsPreflight.status === 204,
  artifactBoundary: artifact.subset.tracked && artifact.subset.matchesHostedImportManifest && Object.values(artifact.forbiddenTracked).every(value => !value) && Object.values(artifact.dockerExcludes).every(Boolean),
  freeAndGreen: resources.services.some(item => item.type === 'web_service' && item.plan === 'free') && resources.services.some(item => item.type === 'static_site') && resources.ci.conclusion === 'success' && resources.ci.headSha === resources.finalDeployCommit,
  separateColdWarm: timings.cold.status === 200 && timings.warm.status === 200 && timings.cold.idleMinutes >= 15 && timings.cold.elapsedMs > 0 && timings.warm.elapsedMs > 0 && timings.targetCommit === resources.finalDeployCommit
};
const passed = Object.values(checks).every(Boolean);
const output = 'docs/data/stage4-gate.json';
writeFileSync(output, JSON.stringify({ checkedAt: new Date().toISOString(), status: passed ? 'passed' : 'open', checks, evidence: [frozenPath, 'tools/bench/results/stage4-explanations-v4.json', 'docs/data/stage4-fault-drill.json', 'docs/data/stage4-deployed-api-smoke.json', 'docs/data/stage4-deployed-site-smoke.json', 'docs/data/stage4-deployed-web-smoke.json', 'docs/data/stage4-deployed-model-smoke.json', 'docs/data/stage4-deployed-source-smoke.json', 'docs/data/stage4-render-log-evidence.json', 'docs/data/stage4-artifact-exclusion.json', 'docs/data/stage4-release-resources.json', 'docs/data/stage4-deployed-timings.json'] }, null, 2) + '\n');
console.log(JSON.stringify({ output, status: passed ? 'passed' : 'open', checks }));
if (!passed) process.exitCode = 1;
