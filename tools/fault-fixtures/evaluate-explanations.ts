import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';
import { MODEL, PROMPT_VERSION, deterministicSelection, requestGroq, type Facts } from '../../apps/server/src/billing/explanation.js';

const path = 'tools/fault-fixtures/explanation-cases-v1.json';
loadEnvFile('.env');
const bytes = readFileSync(path);
const frozen = JSON.parse(bytes.toString()) as { cases: { id: string; label: string; facts: Facts }[] };
if (frozen.cases.length < 30) throw new Error('Frozen set is too small');
const key = process.env.GROQ_API_KEY;
const cases = [];
for (const item of frozen.cases) {
  const start = performance.now();
  const template = deterministicSelection(item.facts);
  const templateLatencyMs = Math.round((performance.now() - start) * 1000) / 1000;
  let groq: unknown = { status: key ? 'not_attempted' : 'not_run_missing_key' };
  if (key) {
    const modelStart = performance.now();
    const rawResponses: { status: number; content?: string | null; promptTokens?: number | null; completionTokens?: number | null; errorCode?: string | null }[] = [];
    const transport: typeof fetch = async (url, init) => {
      const response = await fetch(url, init);
      const raw = await response.clone().json().catch(() => ({})) as { choices?: { message?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { code?: string } };
      rawResponses.push({ status: response.status, content: raw.choices?.[0]?.message?.content ?? null, promptTokens: raw.usage?.prompt_tokens ?? null, completionTokens: raw.usage?.completion_tokens ?? null, errorCode: raw.error?.code ?? null });
      return response;
    };
    try { const response = await requestGroq(item.facts, key, transport); groq = { status: 'accepted', output: response.selection, rawResponses, latencyMs: Math.round((performance.now() - modelStart) * 1000) / 1000, attempts: response.attempts, promptTokens: response.promptTokens, completionTokens: response.completionTokens }; }
    catch (error) { groq = { status: 'fallback', category: error instanceof z.ZodError || error instanceof SyntaxError ? 'invalid_output' : error instanceof Error ? error.message : 'unknown', rawResponses, latencyMs: Math.round((performance.now() - modelStart) * 1000) / 1000 }; }
    // Stay within the published 30-request/minute free-tier guidance when credentials exist.
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  cases.push({ id: item.id, expectedPrimaryReason: item.label, template: { output: template, latencyMs: templateLatencyMs, correct: template.primaryReason === item.label }, groq });
}
const accepted = cases.filter(item => (item.groq as { status: string }).status === 'accepted');
const rawAgreement = cases.filter(item => { const raw = (item.groq as { rawResponses?: { content?: string | null }[] }).rawResponses?.at(-1)?.content; if (!raw) return false; try { return (JSON.parse(raw) as { primaryReason?: string }).primaryReason === item.expectedPrimaryReason; } catch { return false; } }).length;
const report = { evaluatedAt: new Date().toISOString(), provenance: 'fictional_billing_explanation_cases', frozenCaseSha256: createHash('sha256').update(bytes).digest('hex'), model: MODEL, promptVersion: PROMPT_VERSION, caseCount: cases.length, template: { correct: cases.filter(item => item.template.correct).length, total: cases.length }, groq: { attempted: key ? cases.length : 0, accepted: accepted.length, correct: accepted.filter(item => (item.groq as { output: { primaryReason: string } }).output.primaryReason === item.expectedPrimaryReason).length, rawPrimaryReasonAgreement: rawAgreement, total: key ? cases.length : 0, fallbacks: cases.filter(item => (item.groq as { status: string }).status === 'fallback').length, rejectedOutputs: cases.filter(item => ['invalid_output', 'invalid_model_output', 'unsupported_reason', 'numeric_model_text', 'unsupported_fact_reference'].includes((item.groq as { category?: string }).category ?? '') || (item.groq as { rawResponses?: { status: number; errorCode?: string | null }[] }).rawResponses?.some(x => x.status === 400 && x.errorCode === 'json_validate_failed')).length, actualHttpCalls: cases.reduce((sum, item) => sum + ((item.groq as { rawResponses?: unknown[] }).rawResponses?.length ?? 0), 0) }, cache: { callsAvoided: 0, tokensAvoided: 0, note: 'This case-level comparison does not repeat statements; endpoint cache is tested separately.' }, cases };
const output = process.argv[2] ?? 'tools/bench/results/stage4-explanations.json';
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, caseCount: cases.length, template: report.template, groq: report.groq, frozenCaseSha256: report.frozenCaseSha256 }));
