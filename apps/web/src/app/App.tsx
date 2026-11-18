import { useEffect, useState } from 'react';
import { StatusPage } from '../pages/StatusPage';
import { PipelineDemo } from '../pages/PipelineDemo';
import '../style.css';

const apiBase = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3001';
const flats = [
  { id: 'DEMO_A', name: 'Flat A', volumeMl: 3000n },
  { id: 'DEMO_B', name: 'Flat B', volumeMl: 2000n }
] as const;
type Statement = { flatId: string; volumeMl: string; variableMinor: string; fixedMinor: string; sharedMinor: string; totalMinor: string };
type Preview = {
  provenance: 'fictional_billing_fixture';
  persistence: 'none';
  invoice: { invoiceVolumeMl: string; variableMinor: string; fixedMinor: string; totalMinor: string };
  statements: Statement[];
};

function allocate(amount: bigint, weights: readonly { id: string; weight: bigint }[]) {
  const total = weights.reduce((sum, item) => sum + item.weight, 0n);
  const portions = new Map(weights.map(item => [item.id, amount * item.weight / total]));
  const order = [...weights].sort((a, b) => {
    const ar = amount * a.weight % total;
    const br = amount * b.weight % total;
    return ar === br ? a.id.localeCompare(b.id) : ar > br ? -1 : 1;
  });
  let remainder = amount - [...portions.values()].reduce((sum, item) => sum + item, 0n);
  for (const item of order) {
    if (remainder === 0n) break;
    portions.set(item.id, portions.get(item.id)! + 1n);
    remainder--;
  }
  return portions;
}

function browserPreview(variableMinor: string, fixedMinor: string): Preview {
  const variable = BigInt(variableMinor);
  const fixed = BigInt(fixedMinor);
  const variableParts = allocate(variable, flats.map(flat => ({ id: flat.id, weight: flat.volumeMl })));
  const fixedParts = allocate(fixed, flats.map(flat => ({ id: flat.id, weight: 1n })));
  return {
    provenance: 'fictional_billing_fixture',
    persistence: 'none',
    invoice: { invoiceVolumeMl: '5000', variableMinor, fixedMinor, totalMinor: (variable + fixed).toString() },
    statements: flats.map(flat => {
      const usage = variableParts.get(flat.id)!;
      const base = fixedParts.get(flat.id)!;
      return { flatId: flat.id, volumeMl: flat.volumeMl.toString(), variableMinor: usage.toString(), fixedMinor: base.toString(), sharedMinor: '0', totalMinor: (usage + base).toString() };
    })
  };
}

const money = (paise: string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(paise) / 100);
const litres = (ml: string) => (Number(ml) / 1000).toFixed(1) + ' L';
const flatName = (id: string) => flats.find(flat => flat.id === id)?.name ?? id;

export function App() {
  const [view, setView] = useState<'manager' | 'resident'>('manager');
  const [selectedFlat, setSelectedFlat] = useState('DEMO_A');
  const [variableMinor, setVariableMinor] = useState('500');
  const [fixedMinor, setFixedMinor] = useState('200');
  const [preview, setPreview] = useState<Preview>(() => browserPreview('500', '200'));
  const [previewSource, setPreviewSource] = useState<'checking' | 'api' | 'browser'>('checking');
  const [error, setError] = useState('');

  async function fetchPreview(variable: string, fixed: string): Promise<Preview> {
    const query = new URLSearchParams({ variableMinor: variable, fixedMinor: fixed });
    const response = await fetch(apiBase + '/api/v1/demo/preview?' + query);
    if (!response.ok) throw new Error('preview_unavailable');
    return await response.json() as Preview;
  }

  useEffect(() => {
    void fetchPreview('500', '200')
      .then(result => { setPreview(result); setPreviewSource('api'); })
      .catch(() => setPreviewSource('browser'));
  }, []);

  async function recalculate() {
    if (!/^(0|[1-9][0-9]{0,8})$/.test(variableMinor) || !/^(0|[1-9][0-9]{0,8})$/.test(fixedMinor)) {
      setError('Enter a whole, non-negative amount of up to nine digits in each field.');
      return;
    }
    setError('');
    setPreview(browserPreview(variableMinor, fixedMinor));
    setPreviewSource('browser');
    try {
      setPreview(await fetchPreview(variableMinor, fixedMinor));
      setPreviewSource('api');
    } catch { /* Keep the browser sample usable if the API is unavailable. */ }
  }

  const statement = preview.statements.find(item => item.flatId === selectedFlat) ?? preview.statements[0]!;
  const usageShare = Math.round(Number(statement.volumeMl) / Number(preview.invoice.invoiceVolumeMl) * 100);
  const sumOfShares = preview.statements.reduce((sum, item) => sum + BigInt(item.totalMinor), 0n).toString();

  return <div className="site-shell">
    <header className="site-header">
      <a className="brand" href="#top" aria-label="AquaLedger home"><span className="brand-mark">≈</span>AquaLedger</a>
      <nav aria-label="Main navigation"><a href="#pipeline">Event pipeline</a><a href="#demo">Billing sample</a><a href="#data">Data & scope</a></nav>
      <a className="header-link" href="#pipeline">Run an event check <span aria-hidden="true">↗</span></a>
    </header>

    <main id="top">
      <section className="hero section-wrap">
        <div className="hero-copy">
          <p className="eyebrow"><span className="live-dot" /> SOFTWARE ENGINEERING CASE STUDY</p>
          <h1>Every reading has a history.<br /><em>Every bill has a reason.</em></h1>
          <p className="hero-lede">AquaLedger validates historical water events, makes retries safe, records conflicts, and keeps incomplete readings out of billing. Explore a real source-row check, then a separately labeled fictional invoice.</p>
          <div className="hero-actions"><a className="button button-primary" href="#pipeline">Inspect the event pipeline <span aria-hidden="true">→</span></a><a className="button button-ghost" href="#demo">See the billing sample</a></div>
          <p className="hero-note">No account needed. The public API checks a pinned historical row without saving it.</p>
        </div>
        <div className="hero-visual" aria-label="Water events progress through verification to a resident statement">
          <div className="visual-top"><span>FROM EVENT TO DECISION</span><span className="visual-status">● Auditable flow</span></div>
          <div className="visual-flow">
            <div className="flow-node"><span className="node-icon">≋</span><div><small>01 / SOURCE</small><strong>Water events</strong><span>Versioned and checked</span></div></div>
            <div className="flow-line" />
            <div className="flow-node"><span className="node-icon">✓</span><div><small>02 / VERIFY</small><strong>Safe ingestion</strong><span>Replays and conflicts tracked</span></div></div>
            <div className="flow-line" />
            <div className="flow-node active"><span className="node-icon">⊘</span><div><small>03 / GUARD</small><strong>Coverage decision</strong><span>Incomplete events cannot become a bill</span></div></div>
          </div>
          <div className="visual-footer"><span>Historical observations</span><span>≠</span><span>Fictional billing sample</span></div>
        </div>
      </section>

      <section className="proof-strip" aria-label="Project evidence">
        <div><strong>5.57×</strong><span>faster local batch ingestion*</span></div>
        <div><strong>0</strong><span>new rows on a 10,000-event replay*</span></div>
        <div><strong>32/32</strong><span>reason agreement on fictional cases*</span></div>
      </section>

      <section className="section-wrap section-block" id="how-it-works">
        <div className="section-heading"><p className="eyebrow">THE PROBLEM & THE SYSTEM</p><h2>Trust is built before a bill is published.</h2><p>A reading can arrive twice, change under the same source key, or leave a gap. AquaLedger keeps those cases visible and demonstrates billing only with a complete, separately labeled fixture.</p></div>
        <div className="steps-grid">
          <article className="step-card"><span className="step-number">01</span><div className="step-symbol">⌁</div><h3>Audit the input</h3><p>Check source identity, sensor mapping, timestamps, and row content before events enter the database.</p></article>
          <article className="step-card"><span className="step-number">02</span><div className="step-symbol">◎</div><h3>Make replays safe</h3><p>Accept events in batches, identify exact duplicates, and record changed-key conflicts without overwriting history.</p></article>
          <article className="step-card"><span className="step-number">03</span><div className="step-symbol">⊘</div><h3>Keep billing honest</h3><p>Block incomplete historical events from billing. Demonstrate statements with a separate, complete fictional fixture.</p></article>
        </div>
      </section>

      <PipelineDemo />

      <section className="demo-section section-block" id="demo">
        <div className="section-wrap">
          <div className="section-heading demo-heading"><div><p className="eyebrow">SEPARATE BILLING WALKTHROUGH</p><h2>Explore a sample bill.</h2><p>Once the event pipeline is understood, explore how a complete, fictional hour becomes a resident statement. This invoice does not use HSB observations.</p></div><span className="demo-badge">FICTIONAL DATA · NO SIGN IN</span></div>
          <div className="demo-layout">
            <div className="demo-panel">
              <div className="panel-top"><div><small>BILLING PERIOD</small><strong>1 January 2026 · 00:00–01:00</strong><span>Six ten-minute intervals · Asia/Kolkata</span></div><span className="panel-icon">↗</span></div>
              <div className="tab-list" role="tablist" aria-label="Sample views"><button type="button" role="tab" aria-selected={view === 'manager'} className={view === 'manager' ? 'selected' : ''} onClick={() => setView('manager')}>Manager view</button><button type="button" role="tab" aria-selected={view === 'resident'} className={view === 'resident' ? 'selected' : ''} onClick={() => setView('resident')}>Resident view</button></div>
              {view === 'manager' ? <div className="panel-body"><h3>Allocate the illustrative invoice</h3><p className="muted">The complete sample contains 5 L of water use: 3 L for Flat A and 2 L for Flat B.</p><div className="field-grid"><label>Usage-based charge <span>in paise</span><input aria-label="Usage-based charge in paise" inputMode="numeric" value={variableMinor} onChange={event => setVariableMinor(event.target.value)} /></label><label>Fixed charge <span>in paise</span><input aria-label="Fixed charge in paise" inputMode="numeric" value={fixedMinor} onChange={event => setFixedMinor(event.target.value)} /></label></div><button type="button" className="button button-primary calculate-button" onClick={() => void recalculate()}>Recalculate bill <span aria-hidden="true">→</span></button>{error && <p className="form-error" role="alert">{error}</p>}<p className="helper-text">Read-only preview. No database statement is published or changed.</p></div> : <div className="panel-body"><h3>View a resident statement</h3><p className="muted">Switch flats to see the sample from each resident's perspective.</p><div className="flat-switch" aria-label="Select a fictional flat">{flats.map(flat => <button type="button" key={flat.id} className={selectedFlat === flat.id ? 'selected' : ''} aria-pressed={selectedFlat === flat.id} onClick={() => setSelectedFlat(flat.id)}>{flat.name}</button>)}</div><div className="resident-explanation"><span>WHY THIS AMOUNT?</span><p>{flatName(statement.flatId)} used {litres(statement.volumeMl)} of the complete {litres(preview.invoice.invoiceVolumeMl)} sample, so it receives {usageShare}% of the usage-based charge. The fixed charge is split equally.</p><small>Deterministic sample explanation. The protected product path also validates model-selected reasons.</small></div></div>}
            </div>
            <div className="bill-card"><div className="bill-header"><span>SAMPLE INVOICE</span><span className="invoice-chip">ILLUSTRATIVE</span></div><div className="bill-total"><small>Total to allocate</small><strong>{money(preview.invoice.totalMinor)}</strong><span>{litres(preview.invoice.invoiceVolumeMl)} across two fictional flats</span></div><div className="bill-lines"><div><span>Usage-based</span><strong>{money(preview.invoice.variableMinor)}</strong></div><div><span>Fixed charge</span><strong>{money(preview.invoice.fixedMinor)}</strong></div></div><div className="bill-divider" /><p className="bill-subhead">Resident shares</p>{preview.statements.map(item => { const percentage = Math.round(Number(item.volumeMl) / Number(preview.invoice.invoiceVolumeMl) * 100); return <div className={'share-row ' + (view === 'resident' && selectedFlat === item.flatId ? 'highlighted' : '')} key={item.flatId}><div><strong>{flatName(item.flatId)}</strong><span>{litres(item.volumeMl)} · {percentage}% of use</span></div><strong>{money(item.totalMinor)}</strong><div className="share-track"><span style={{ width: percentage + '%' }} /></div></div>; })}<div className="bill-footer"><span>Exact reconciliation</span><strong>{money(sumOfShares)} / {money(preview.invoice.totalMinor)}</strong></div><p className="preview-source">{previewSource === 'api' ? 'Calculated by the public, read-only API.' : previewSource === 'checking' ? 'Checking the public calculation…' : 'Calculated in your browser while the API is unavailable.'}</p></div>
          </div>
        </div>
      </section>

      <StatusPage />

      <section className="section-wrap closing-section"><div><p className="eyebrow">ENGINEERING DETAILS</p><h2>Built for correctness under real failure modes.</h2><p>Authenticated ingestion, transactional replay handling, integer charge allocation, immutable revisions, validated explanation selections, and operational fallback paths sit behind this public sample.</p></div><a className="button button-ghost" href="https://github.com/harshgmrn04-byte/AquaLedger" target="_blank" rel="noreferrer">View the code <span aria-hidden="true">↗</span></a></section>
    </main>
    <footer><span className="brand"><span className="brand-mark">≈</span>AquaLedger</span><span>* Local and frozen-fixture test results; no production or customer-performance claim.</span><a href="https://github.com/harshgmrn04-byte/AquaLedger" target="_blank" rel="noreferrer">GitHub ↗</a></footer>
  </div>;
}
