import { useEffect, useState } from 'react';

const apiBase = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3001';
type Summary = { status: string; eventCount: string; apartmentCount?: string; datasetVersion?: string; lastImportedAt?: string | null };

export function StatusPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    void fetch(apiBase + '/api/v1/source-events/summary')
      .then(async response => { if (!response.ok) throw new Error('unavailable'); setRequestId(response.headers.get('x-request-id')); setSummary(await response.json() as Summary); })
      .catch(() => setUnavailable(true));
  }, []);

  const stateText = summary?.status === 'available'
    ? Number(summary.eventCount).toLocaleString('en-IN') + ' verified imported events · ' + (summary.apartmentCount ?? '—') + ' apartment pseudonyms'
    : unavailable ? 'Live source summary is unavailable; this description is an archive snapshot.'
      : summary?.status === 'no_verified_import' ? 'No verified import is available on this server.' : 'Checking source summary…';

  return <section className="data-section section-wrap" id="data">
    <div className="section-heading"><p className="eyebrow">DATA & SCOPE</p><h2>Two sources. One clear boundary.</h2><p>Historical observations test ingestion. The bill above uses a separate, complete fictional fixture because the historical file cannot certify a full billing period.</p></div>
    <div className="data-grid">
      <article className="data-card observed"><span className="data-tag">OBSERVED · HISTORICAL</span><h3>HSB water events</h3><p>Published observations from Gothenburg, Sweden, December 2019–January 2023. The source contains positive events, with no coverage-certified billing window.</p><p className="data-state">{stateText}</p>{summary?.status === 'available' && <p className="source-api-proof">Live PostgreSQL summary · HSB {summary.datasetVersion ?? '1.1.0'}{requestId ? ' · Request ' + requestId.slice(0, 8) : ''}</p>}<div className="source-links"><a href={apiBase + '/api/v1/source-events/summary'} target="_blank" rel="noreferrer">Open database-backed API JSON ↗</a><a href="https://zenodo.org/records/22076411" target="_blank" rel="noreferrer">View dataset and licence ↗</a></div></article>
      <article className="data-card fictional"><span className="data-tag">FICTIONAL · COMPLETE</span><h3>Billing walkthrough</h3><p>Six complete ten-minute intervals for two fictional flats, with an illustrative INR invoice. No HSB event becomes a billing reading.</p><p className="data-state">The public billing preview is read only and stores nothing.</p><a href="#demo">Explore the sample bill ↑</a></article>
    </div>
    <p className="source-note">Source-unit note: HSB values are interpreted as m³ from aggregate evidence although its dictionary says litres. Historical event sums are analytics only.</p>
  </section>;
}
