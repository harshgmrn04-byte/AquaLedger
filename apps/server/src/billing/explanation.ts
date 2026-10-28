import { createHash } from 'node:crypto';
import { z } from 'zod';

export const MODEL = 'openai/gpt-oss-20b';
export const PROMPT_VERSION = 'fictional-statement-reasons-v4';
export const reasonCodes = ['first_statement', 'higher_variable_charge', 'lower_variable_charge', 'higher_fixed_charge', 'lower_fixed_charge', 'higher_shared_charge', 'lower_shared_charge', 'unchanged'] as const;
export const factKeys = ['current_variable_minor', 'current_fixed_minor', 'current_shared_minor', 'current_total_minor', 'previous_variable_minor', 'previous_fixed_minor', 'previous_shared_minor', 'previous_total_minor'] as const;
const selectionSchema = z.strictObject({ primaryReason: z.enum(reasonCodes), factRefs: z.array(z.enum(factKeys)).min(1).max(4), summary: z.string().trim().min(1).max(240) });
export type Selection = z.infer<typeof selectionSchema>;
export type Facts = { revisionId: string; statementId: string; current: { variableMinor: string; fixedMinor: string; sharedMinor: string; totalMinor: string }; previous: { variableMinor: string; fixedMinor: string; sharedMinor: string; totalMinor: string } | null };
const asBig = (value: string) => BigInt(value);

export function primaryReason(facts: Facts): typeof reasonCodes[number] {
  if (!facts.previous) return 'first_statement';
  const fields = ['variableMinor', 'fixedMinor', 'sharedMinor'] as const;
  let best = 0n, reason: typeof reasonCodes[number] = 'unchanged';
  for (const field of fields) {
    const delta = asBig(facts.current[field]) - asBig(facts.previous[field]);
    const magnitude = delta < 0n ? -delta : delta;
    if (magnitude > best) { best = magnitude; reason = `${delta > 0n ? 'higher' : 'lower'}_${field === 'variableMinor' ? 'variable_charge' : field === 'fixedMinor' ? 'fixed_charge' : 'shared_charge'}` as typeof reasonCodes[number]; }
  }
  return reason;
}

export function deterministicSelection(facts: Facts): Selection {
  const reason = primaryReason(facts);
  const field = reason.includes('variable') ? 'variable' : reason.includes('fixed') ? 'fixed' : reason.includes('shared') ? 'shared' : 'total';
  return { primaryReason: reason, factRefs: [`current_${field}_minor` as typeof factKeys[number], ...(facts.previous ? [`previous_${field}_minor` as typeof factKeys[number]] : [])], summary: reason === 'first_statement' ? 'This is the first published statement for this period.' : reason === 'unchanged' ? 'The charge components match the earlier published statement.' : `The ${field} charge is the largest change from the earlier published statement.` };
}

export function validateSelection(raw: unknown, facts: Facts): Selection {
  const value = selectionSchema.parse(raw);
  if (/[0-9₹$€£]|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|lakh|crore|rupee|rupees|paisa|paise|percent|percentage|second|third|fourth|fifth)\b/i.test(value.summary)) throw new Error('numeric_model_text');
  if (value.primaryReason !== primaryReason(facts)) throw new Error('unsupported_reason');
  for (const ref of value.factRefs) if (ref.startsWith('previous_') && !facts.previous) throw new Error('unsupported_fact_reference');
  const required = deterministicSelection(facts).factRefs;
  if (required.some(ref => !value.factRefs.includes(ref))) throw new Error('unsupported_fact_reference');
  return value;
}

export function factsHash(facts: Facts): string { return createHash('sha256').update(JSON.stringify(facts)).digest('hex'); }
export function renderExplanation(selection: Selection, facts: Facts) {
  const current = facts.current.totalMinor;
  const previous = facts.previous?.totalMinor ?? null;
  return { primaryReason: selection.primaryReason, factRefs: selection.factRefs, summary: deterministicSelection(facts).summary, currentTotalMinor: current, previousTotalMinor: previous, fixtureProvenance: 'fictional_billing_fixture' as const, invoiceProvenance: 'illustrative_invoice' as const };
}

const responseSchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1), usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }).optional() });
export type ModelResult = { selection: Selection; promptTokens: number | null; completionTokens: number | null; attempts: number };
export async function requestGroq(facts: Facts, key: string, transport: typeof fetch = fetch): Promise<ModelResult> {
  const allowedRefs = facts.previous ? [...factKeys] : factKeys.filter(key => key.startsWith('current_'));
  const schema = { type: 'object', additionalProperties: false, required: ['primaryReason', 'factRefs', 'summary'], properties: { primaryReason: { type: 'string', enum: [...reasonCodes] }, factRefs: { type: 'array', items: { type: 'string', enum: allowedRefs } }, summary: { type: 'string' } } };
  const body = { model: MODEL, messages: [{ role: 'system', content: 'Classify the largest absolute change among variable, fixed, and shared charges. If no previous statement exists choose first_statement. If all components match choose unchanged. For first_statement, factRefs must contain exactly current_total_minor. For unchanged, factRefs must contain exactly current_total_minor and previous_total_minor. For a higher or lower component charge, factRefs must contain exactly the current and previous keys for that component, and no other keys. Use only supplied fact keys. Write a short summary with no figures, number words, currency, percentages, or invented facts. This is a fictional billing fixture.' }, { role: 'user', content: JSON.stringify({ facts, allowedRefs }) }], response_format: { type: 'json_schema', json_schema: { name: 'statement_explanation', strict: true, schema } }, reasoning_effort: 'low', temperature: 0, max_completion_tokens: 768 };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await transport('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3500) });
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < 2) continue;
        throw new Error(response.status === 429 ? 'groq_rate_limited' : 'groq_http_error');
      }
      const payload = responseSchema.parse(await response.json());
      const content = payload.choices[0]!.message.content;
      if (!content || content.length > 4096) throw new Error('invalid_model_output');
      return { selection: validateSelection(JSON.parse(content), facts), promptTokens: payload.usage?.prompt_tokens ?? null, completionTokens: payload.usage?.completion_tokens ?? null, attempts: attempt };
    } catch (error) {
      if (attempt < 2 && error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) continue;
      throw error;
    }
  }
  throw new Error('groq_unavailable');
}
