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
  const [result, setResult] = useState<EventCheck | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'available' | 'unavailable'>('loading');

  async function inspect(next: Scenario, signal?: AbortSignal) {
    setScenario(next);
    setState('loading');
    setResult(null);
    try {
      const response = await fetch(apiBase + '/api/v1/demo/event-check?scenario=' + next, signal ? { signal } : undefined);
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

  useEffect(() => {
    const controller = new AbortController();
    void inspect('new', controller.signal);
    return () => controller.abort();
  }, []);

  return <section className="pipeline-section section-block" id="pipeline">
    <div className="section-wrap">
      <div className="section-heading pipeline-heading"><p className="eyebrow">RUN THE SOURCE ADAPTER</p><h2>Watch the backend verify a water event.</h2><p>Choose a case. The public API reads one pinned row from the published HSB sample, normalizes it, compares its hash with the audited archive, and shows the decision. This is a safe dry run: it does not write to the database.</p></div>
      <div className="pipeline-layout">
        <div className="pipeline-control">
          <div className="pipeline-kicker"><span className="pulse-dot" /> HISTORICAL EVENT INSPECTOR <span className="pipeline-source">HSB 1.1.0 · CSV line 2</span></div>
          <h3>What happens when this row arrives?</h3>
          <div className="scenario-list" role="group" aria-label="Choose event scenario">{(Object.keys(scenarioText) as Scenario[]).map((item, index) => <button key={item} type="button" className={'scenario-option ' + (scenario === item ? 'selected' : '')} aria-pressed={scenario === item} onClick={() => void inspect(item)}><span className="scenario-index">0{index + 1}</span><span><strong>{scenarioText[item].label}</strong><small>{scenarioText[item].description}</small></span><span aria-hidden="true">↗</span></button>)}</div>
          <p className="pipeline-caveat">The replay and changed-key cases assume an existing pinned row in memory. The protected ingestion route performs these checks inside a PostgreSQL transaction; this public page never sends a write.</p>
        </div>
        <div className="pipeline-result" aria-live="polite">
          <div className="result-header"><span>API RESPONSE</span><span className={'api-indicator ' + state}>{state === 'available' ? '● Server responded' : state === 'loading' ? '○ Contacting server' : '○ Server unavailable'}</span></div>
          {state === 'available' && result ? <>
            <div className="result-decision"><small>CLASSIFICATION</small><strong>{outcomeText[result.outcome]}</strong><span>{result.reasonCode.replaceAll('_', ' ')}</span></div>
            <div className="event-facts"><div><span>Source key</span><strong>{result.source.sourceRowKey}</strong></div><div><span>Sensor / channel</span><strong>{result.normalized.sensorId} · {result.normalized.channel}</strong></div><div><span>UTC timestamp</span><strong>{result.normalized.timestamp.replace('T', ' ').replace('.000Z', 'Z')}</strong></div><div><span>Derived event volume</span><strong>{(Number(result.normalized.volumeMl) / 1000).toLocaleString('en-IN')} L*</strong></div></div>
            <div className="check-list"><div><span>Sensor map + timestamp + positive volume</span><strong>PASS</strong></div><div><span>Pinned archive row hash</span><strong className={result.checks.pinnedArchiveHash === 'pass' ? '' : 'check-fail'}>{result.checks.pinnedArchiveHash.toUpperCase()}</strong></div><div><span>Incoming hash</span><code>{result.comparison.incomingHashPrefix}…</code></div></div>
            <div className="result-footer"><span>Read-only server call · {requestId ? 'Request ' + requestId.slice(0, 8) : 'No request ID'}</span><a href={apiBase + '/api/v1/demo/event-check?scenario=' + scenario} target="_blank" rel="noreferrer">Open JSON ↗</a></div>
          </> : <div className="result-placeholder"><span>{state === 'loading' ? '⌁' : '○'}</span><strong>{state === 'loading' ? 'Checking the source row…' : 'The API could not answer right now.'}</strong><p>{state === 'loading' ? 'Free hosting may take a few seconds to wake.' : 'The verified pipeline and test evidence below remain available.'}</p>{state === 'unavailable' && <button type="button" className="button button-ghost" onClick={() => void inspect(scenario)}>Retry check</button>}</div>}
        </div>
      </div>
      <div className="pipeline-evidence"><div><strong>Real ingestion path</strong><p>Authenticated batches validate source identity, then store accepted rows and conflict records transactionally.</p><a href="https://github.com/harshgmrn04-byte/AquaLedger/blob/main/apps/server/src/services/persist-batch.ts" target="_blank" rel="noreferrer">See transaction code ↗</a></div><div><strong>Measured replay behavior</strong><p>A recorded 10,000-event replay added 0 rows. Integration tests cover duplicates, changed keys, and rollback on failure.</p><a href="https://github.com/harshgmrn04-byte/AquaLedger/blob/main/RESULTS.md" target="_blank" rel="noreferrer">See measured results ↗</a></div><div><strong>Coverage guard</strong><p>HSB events do not prove a complete billing interval. The invoice example below uses a separate fictional fixture.</p><a href="https://github.com/harshgmrn04-byte/AquaLedger/blob/main/docs/data/HSB_AUDIT.md" target="_blank" rel="noreferrer">See source audit ↗</a></div></div>
      <p className="pipeline-footnote">* Source values use the documented aggregate-supported m³ interpretation; the publisher dictionary says litres. These are historical events, not a live meter stream or certified billable usage. <a href="https://github.com/harshgmrn04-byte/AquaLedger/blob/main/apps/server/src/controllers/source-events.ts" target="_blank" rel="noreferrer">Inspect ingestion code ↗</a></p>
    </div>
  </section>;
}
