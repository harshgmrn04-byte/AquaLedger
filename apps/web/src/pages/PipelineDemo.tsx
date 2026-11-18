import { useEffect, useState } from 'react';

const apiBase = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3001';
type Scenario = 'new' | 'replay' | 'changed';
type EventCheck = {
  provenance: string;
  mode: 'stateless_dry_run';
  source: { sourceRowKey: string; csvLine: number };
  normalized: { sensorId: string; apartment: string | null; timestamp: string; volumeMl: string; channel: string };
  checks: { sensorMapping: string; utcTimestamp: string; positiveVolume: string; pinnedArchiveHash: string };
  comparison: { priorState: string; priorHashPrefix: string | null; incomingHashPrefix: string };
  outcome: 'accepted' | 'duplicate' | 'conflict' | 'rejected';
  reasonCode: string;
};

const scenarioText: Record<Scenario, { label: string; description: string }> = {
  new: { label: 'New event', description: 'A pinned historical CSV row with no prior row assumed.' },
  replay: { label: 'Exact replay', description: 'The same row and hash are assumed to exist already.' },
  changed: { label: 'Changed source key', description: 'An injected value change reuses the same CSV line identity.' }
};

const outcomeText: Record<EventCheck['outcome'], string> = {
  accepted: 'Eligible for insert',
  duplicate: 'Idempotent duplicate',
  conflict: 'Changed-key conflict',
  rejected: 'Rejected'
};

export function PipelineDemo() {
  const [scenario, setScenario] = useState<Scenario>('new');
  const [lineValue, setLineValue] = useState('2');
  const [lineError, setLineError] = useState('');
  const [result, setResult] = useState<EventCheck | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'available' | 'unavailable'>('loading');

  async function inspect(next: Scenario, line: number, signal?: AbortSignal) {
    setScenario(next);
    setState('loading');
    setResult(null);
    try {
      const query = new URLSearchParams({ scenario: next, line: String(line) });
      const response = await fetch(apiBase + '/api/v1/demo/event-check?' + query, signal ? { signal } : undefined);
      if (!response.ok) throw new Error('source_check_unavailable');
      const body = await response.json() as EventCheck;
      setResult(body);
      setRequestId(response.headers.get('x-request-id'));
      setState('available');
    } catch {
      if (signal?.aborted) return;
      setState('unavailable');
    }
  }

  function run(next: Scenario) {
    const line = Number(lineValue);
    if (!/^\d+$/.test(lineValue) || !Number.isInteger(line) || line < 2 || line > 1001) {
      setLineError('Choose a whole CSV line from 2 to 1001.');
      return;
    }
    setLineError('');
    void inspect(next, line);
  }

  useEffect(() => {
    const controller = new AbortController();
    void inspect('new', 2, controller.signal);
    return () => controller.abort();
  }, []);

  return <section className="pipeline-section section-block" id="pipeline">
    <div className="section-wrap">
      <div className="section-heading pipeline-heading"><p className="eyebrow">RUN THE SOURCE ADAPTER</p><h2>Watch the backend verify a water event.</h2><p>Pick any of the 1,000 pinned historical rows and a scenario. The public API normalizes your chosen row, compares its hash with the audited archive, and returns a fresh request ID. This is a safe dry run: it does not write to the database.</p></div>
      <div className="pipeline-layout">
        <div className="pipeline-control">
          <div className="pipeline-kicker"><span className="pulse-dot" /> HISTORICAL EVENT INSPECTOR <span className="pipeline-source">HSB 1.1.0 · 1,000 pinned rows</span></div>
          <h3>What happens when this row arrives?</h3>
          <div className="source-picker"><label htmlFor="source-line">Choose a CSV line <small>2–1001</small></label><div><input id="source-line" aria-label="Historical CSV line" inputMode="numeric" value={lineValue} onChange={event => setLineValue(event.target.value)} /><button type="button" onClick={() => run(scenario)}>Inspect chosen row <span aria-hidden="true">→</span></button></div>{lineError && <p className="source-picker-error" role="alert">{lineError}</p>}</div>
          <div className="scenario-list" role="group" aria-label="Choose event scenario">{(Object.keys(scenarioText) as Scenario[]).map((item, index) => <button key={item} type="button" className={'scenario-option ' + (scenario === item ? 'selected' : '')} aria-pressed={scenario === item} onClick={() => run(item)}><span className="scenario-index">0{index + 1}</span><span><strong>{scenarioText[item].label}</strong><small>{scenarioText[item].description}</small></span><span aria-hidden="true">↗</span></button>)}</div>
          <p className="pipeline-caveat">The replay and changed-key cases assume an existing pinned row in memory. The protected ingestion route performs these checks inside a PostgreSQL transaction; this public page never sends a write.</p>
        </div>
        <div className="pipeline-result" aria-live="polite">
          <div className="result-header"><span>API RESPONSE</span><span className={'api-indicator ' + state}>{state === 'available' ? '● Server responded' : state === 'loading' ? '○ Contacting server' : '○ Server unavailable'}</span></div>
          {state === 'available' && result ? <>
            <div className="result-decision"><small>CLASSIFICATION</small><strong>{outcomeText[result.outcome]}</strong><span>{result.reasonCode.replaceAll('_', ' ')}</span></div>
            <div className="event-facts"><div><span>Source key</span><strong>{result.source.sourceRowKey}</strong></div><div><span>Sensor / channel</span><strong>{result.normalized.sensorId} · {result.normalized.channel}</strong></div><div><span>UTC timestamp</span><strong>{result.normalized.timestamp.replace('T', ' ').replace('.000Z', 'Z')}</strong></div><div><span>Derived event volume</span><strong>{(Number(result.normalized.volumeMl) / 1000).toLocaleString('en-IN')} L*</strong></div></div>
            <div className="check-list"><div><span>Sensor map + timestamp + positive volume</span><strong>PASS</strong></div><div><span>Pinned archive row hash</span><strong className={result.checks.pinnedArchiveHash === 'pass' ? '' : 'check-fail'}>{result.checks.pinnedArchiveHash.toUpperCase()}</strong></div><div><span>Incoming hash</span><code>{result.comparison.incomingHashPrefix}…</code></div></div>
            <div className="result-footer"><span>Read-only server call · {requestId ? 'Request ' + requestId.slice(0, 8) : 'No request ID'}</span><a href={apiBase + '/api/v1/demo/event-check?' + new URLSearchParams({ scenario, line: String(result.source.csvLine) })} target="_blank" rel="noreferrer">Open JSON ↗</a></div>
          </> : <div className="result-placeholder"><span>{state === 'loading' ? '⌁' : '○'}</span><strong>{state === 'loading' ? 'Checking the source row…' : 'The API could not answer right now.'}</strong><p>{state === 'loading' ? 'Free hosting may take a few seconds to wake.' : 'The verified pipeline and test evidence below remain available.'}</p>{state === 'unavailable' && <button type="button" className="button button-ghost" onClick={() => run(scenario)}>Retry check</button>}</div>}
        </div>
      </div>
      <div className="pipeline-evidence"><div><strong>Real ingestion path</strong><p>Authenticated batches validate source identity, then store accepted rows and conflict records transactionally.</p><a href="https://github.com/harshgmrn04-byte/AquaLedger/blob/main/apps/server/src/services/persist-batch.ts" target="_blank" rel="noreferrer">See transaction code ↗</a></div><div><strong>Measured replay behavior</strong><p>A recorded 10,000-event replay added 0 rows. Integration tests cover duplicates, changed keys, and rollback on failure.</p><a href="https://github.com/harshgmrn04-byte/AquaLedger/blob/main/RESULTS.md" target="_blank" rel="noreferrer">See measured results ↗</a></div><div><strong>Coverage guard</strong><p>HSB events do not prove a complete billing interval. The invoice example below uses a separate fictional fixture.</p><a href="https://github.com/harshgmrn04-byte/AquaLedger/blob/main/docs/data/HSB_AUDIT.md" target="_blank" rel="noreferrer">See source audit ↗</a></div></div>
      <div className="metric-proof"><div className="metric-proof-heading"><div><p className="eyebrow">MEASUREMENT TRAIL</p><h3>The numbers have raw results.</h3><p>These are saved local tests and frozen fictional cases. They are not live-site throughput or customer outcomes.</p></div><a href="https://github.com/harshgmrn04-byte/AquaLedger/blob/main/RESULTS.md" target="_blank" rel="noreferrer">Read the full results ↗</a></div><div className="metric-proof-grid"><div><strong>5.57×</strong><span>median local HTTP ingestion throughput</span><p>10,473.4 → 58,347.6 events/s across five matched 10,000-event runs per version.</p><a href="https://github.com/harshgmrn04-byte/AquaLedger/blob/main/tools/bench/results/stage2-http-baseline-modular-2026-10-28.json" target="_blank" rel="noreferrer">Baseline JSON ↗</a><a href="https://github.com/harshgmrn04-byte/AquaLedger/blob/main/tools/bench/results/stage2-http-final-modular-2026-10-28.json" target="_blank" rel="noreferrer">Final JSON ↗</a></div><div><strong>78.3%</strong><span>lower local request p95</span><p>196.8 → 42.8 ms in the same matched benchmark. This does not measure Render latency.</p><a href="https://github.com/harshgmrn04-byte/AquaLedger/blob/main/RESULTS.md" target="_blank" rel="noreferrer">Method and scope ↗</a></div><div><strong>0 new rows</strong><span>on a 10,000-event replay</span><p>The saved final run classified 10,000 duplicates and retained a 10,000-row count.</p><a href="https://github.com/harshgmrn04-byte/AquaLedger/blob/main/tools/bench/results/stage2-http-final-modular-2026-10-28.json" target="_blank" rel="noreferrer">Replay JSON ↗</a></div><div><strong>32/32</strong><span>frozen fictional explanation cases</span><p>Actual Groq responses matched expected reasons and passed schema checks. Two repeat hosted-dependency requests made 0 new model calls.</p><a href="https://github.com/harshgmrn04-byte/AquaLedger/blob/main/tools/bench/results/stage4-explanations-v4.json" target="_blank" rel="noreferrer">Case-level JSON ↗</a><a href="https://github.com/harshgmrn04-byte/AquaLedger/blob/main/docs/data/stage4-hosted-local-api-smoke.json" target="_blank" rel="noreferrer">Cache evidence ↗</a></div></div></div>
      <p className="pipeline-footnote">* Source values use the documented aggregate-supported m³ interpretation; the publisher dictionary says litres. These are historical events, not a live meter stream or certified billable usage. <a href="https://github.com/harshgmrn04-byte/AquaLedger/blob/main/apps/server/src/controllers/source-events.ts" target="_blank" rel="noreferrer">Inspect ingestion code ↗</a></p>
    </div>
  </section>;
}
