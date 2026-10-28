import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deterministicSelection, primaryReason, requestGroq, validateSelection, type Facts } from './explanation.js';

const frozen = JSON.parse(readFileSync('tools/fault-fixtures/explanation-cases-v1.json', 'utf8')) as { cases: { id: string; label: string; facts: Facts }[] };
const first = frozen.cases[0]!.facts;
describe('fictional explanation boundaries', () => {
  it('keeps all frozen template labels in agreement', () => {
    expect(frozen.cases).toHaveLength(32);
    for (const item of frozen.cases) expect(primaryReason(item.facts), item.id).toBe(item.label);
  });
  it('rejects unsupported fact references and numeric model prose', () => {
    const selection = deterministicSelection(first);
    expect(() => validateSelection({ ...selection, factRefs: ['previous_total_minor'] }, first)).toThrow();
    expect(() => validateSelection({ ...selection, summary: 'Your bill was 400' }, first)).toThrow('numeric_model_text');
    expect(() => validateSelection({ ...selection, primaryReason: 'higher_fixed_charge' }, first)).toThrow('unsupported_reason');
  });
  it('uses strict structured output and accepts validated content', async () => {
    const selection = deterministicSelection(first);
    let request: Record<string, unknown> = {};
    const transport = async (_url: unknown, init?: RequestInit) => { request = JSON.parse(String(init?.body)) as Record<string, unknown>; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(selection) } }], usage: { prompt_tokens: 12, completion_tokens: 8 } }), { status: 200 }); };
    const result = await requestGroq(first, 'test-key', transport as typeof fetch);
    expect(result.selection.primaryReason).toBe('first_statement');
    expect(result.promptTokens).toBe(12);
    expect(request.model).toBe('openai/gpt-oss-20b');
    expect((request.response_format as { json_schema: { strict: boolean } }).json_schema.strict).toBe(true);
  });
  it('bounds 429 retry and rejects malformed response', async () => {
    let attempts = 0;
    const limited = async () => { attempts++; return new Response('{}', { status: 429 }); };
    await expect(requestGroq(first, 'test-key', limited as typeof fetch)).rejects.toThrow('groq_rate_limited');
    expect(attempts).toBe(2);
    const malformed = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{bad' } }] }), { status: 200 });
    await expect(requestGroq(first, 'test-key', malformed as typeof fetch)).rejects.toBeInstanceOf(SyntaxError);
  });
});
