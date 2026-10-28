import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { StatusPage } from '../pages/StatusPage';
import '../style.css';

const apiBase = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3001';
const supabase = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) : null;
type Identity = { role: 'manager' | 'resident'; societyId: string; flatId: string | null };
type Invoice = { invoiceVolumeMl: string | null; variableMinor: string; fixedMinor: string; totalMinor: string };
type Period = { id: string; status: string; invoice: Invoice };
type Statement = { flatId: string; volumeMl: string; variableMinor: string; sharedMinor: string; fixedMinor: string; totalMinor: string };
type Preview = { previewHash: string; statements: Statement[] };
type ListedStatement = { periodId: string; revisionNumber: number; snapshot: Statement };
type Explanation = { primaryReason: string; summary: string; currentTotalMinor: string; previousTotalMinor: string | null; source: 'groq' | 'fallback' | 'cache'; fallbackReason?: string | null };
const example: Invoice = { invoiceVolumeMl: '5000', variableMinor: '500', fixedMinor: '200', totalMinor: '700' };
export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [period, setPeriod] = useState<Period | null>(null);
  const [invoice, setInvoice] = useState<Invoice>(example); const [preview, setPreview] = useState<Preview | null>(null);
  const [statements, setStatements] = useState<ListedStatement[]>([]);
  const [explanations, setExplanations] = useState<Record<string, Explanation>>({});
  async function request(path: string, method = 'GET', body?: unknown, key?: string, accessToken = token): Promise<unknown> {
    const response = await fetch(`${apiBase}/api/v1${path}`, { method, headers: { authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(key ? { 'idempotency-key': key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(String(result.error ?? `HTTP ${response.status}`));
    return result;
  }
  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setToken(session?.access_token ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!token) { setIdentity(null); setPeriod(null); setPreview(null); setStatements([]); setExplanations({}); return; }
    void request('/me', 'GET', undefined, undefined, token).then(value => {
      const p = value as Identity; setIdentity(p);
      if (p.role === 'resident') void request('/me/statements', 'GET', undefined, undefined, token).then(v => setStatements((v as { statements: ListedStatement[] }).statements)).catch(e => setError(String(e)));
      if (p.role === 'manager') void request('/billing-periods', 'GET', undefined, undefined, token).then(v => {
        const periods = (v as { periods: Period[] }).periods;
        const selected = periods.find(item => item.status === 'draft') ?? periods[0];
        if (selected) { setPeriod(selected); setInvoice(selected.invoice); }
      }).catch(e => setError(String(e)));
    }).catch(e => setError(String(e)));
  }, [token]);
  async function act(action: () => Promise<void>) { try { setError(''); await action(); } catch (e) { setError(e instanceof Error ? e.message : 'request_failed'); } }
  async function signIn() { if (!supabase) throw new Error('Supabase Auth is not configured'); const { error: authError } = await supabase.auth.signInWithPassword({ email, password }); if (authError) throw authError; }
  const invoiceBody = () => ({ periodStartLocal: '2026-01-01T00:00:00+05:30', periodEndLocal: '2026-01-01T01:00:00+05:30', currency: 'INR', ...invoice });
  return <main><h1>Smart Water Metering Platform</h1><StatusPage /><section className="billing"><h2>Fictional billing walkthrough</h2><p><strong>Fictional fixture and illustrative INR invoice.</strong> Six complete ten-minute intervals for two fictional flats on 1 January 2026 in Asia/Kolkata. The example assumes 100 paise per litre for 5 litres (500 paise variable) plus 200 paise fixed, totaling 700 paise. No HSB event is a billing reading.</p>
    {!identity && <form onSubmit={event => { event.preventDefault(); void act(signIn); }}><label>Email <input aria-label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} /></label><label>Password <input aria-label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} /></label><button type="submit">Sign in</button></form>}
    {identity && <p>Signed in as {identity.role} for {identity.societyId}{identity.flatId ? `, flat ${identity.flatId}` : ''}. <button onClick={() => void supabase?.auth.signOut()}>Sign out</button></p>}
    {identity?.role === 'manager' && <div><h3>Manager draft</h3><p>Period: 1 January 2026, 00:00–01:00 Asia/Kolkata. Amounts are integer paise; volume is integer millilitres.</p>
      {(['invoiceVolumeMl', 'variableMinor', 'fixedMinor', 'totalMinor'] as const).map(field => <label key={field}>{field}<input aria-label={field} value={invoice[field] ?? ''} onChange={e => { setInvoice({ ...invoice, [field]: e.target.value || (field === 'invoiceVolumeMl' ? null : '') }); setPreview(null); }} /></label>)}
      <div className="actions">{!period && <button onClick={() => void act(async () => { try { const p = await request('/billing-periods', 'POST', invoiceBody()) as Period; setPeriod(p); setPreview(null); } catch (e) { if (!(e instanceof Error) || e.message !== 'billing_period_exists') throw e; const periods = (await request('/billing-periods') as { periods: Period[] }).periods; const existing = periods.find(item => item.status === 'draft') ?? periods[0]; if (!existing) throw e; setPeriod(existing); setInvoice(existing.invoice); } })}>Create draft</button>}
        {period?.status === 'draft' && <p>Existing fictional draft loaded. You can edit or preview it.</p>}
        {period?.status === 'draft' && <><button onClick={() => void act(async () => { const p = await request(`/billing-periods/${period.id}`, 'PUT', invoiceBody()) as Period; setPeriod(p); setPreview(null); })}>Save edit</button><button onClick={() => void act(async () => setPreview(await request(`/billing-periods/${period.id}/preview`, 'POST', {}) as Preview))}>Preview</button></>}
        {period?.status === 'published' && <button onClick={() => void act(async () => { const p = await request(`/billing-periods/${period.id}/revisions`, 'POST', {}, crypto.randomUUID()) as Period; setPeriod(p); setPreview(null); })}>Create revision draft</button>}</div>
      {preview && <div><h4>Read-only preview</h4><p>Hash: {preview.previewHash}</p>{preview.statements.map(s => <p key={s.flatId}>{s.flatId}: {s.volumeMl} mL; variable {s.variableMinor}, shared {s.sharedMinor}, fixed {s.fixedMinor}, total {s.totalMinor} paise — fictional fixture, illustrative invoice</p>)}<button onClick={() => void act(async () => { await request(`/billing-periods/${period!.id}/publish`, 'POST', { previewHash: preview.previewHash }, crypto.randomUUID()); setPeriod({ ...period!, status: 'published' }); setPreview(null); })}>Publish</button></div>}
      {period?.status === 'published' && <p>Published fictional statements. Prior revisions remain available to residents.</p>}</div>}
    {identity?.role === 'resident' && <div>
      <h3>My statements</h3>
      <button onClick={() => void act(async () => setStatements((await request('/me/statements') as { statements: ListedStatement[] }).statements))}>Refresh statements</button>
      {statements.map(s => {
        const explanation = explanations[s.periodId];
        return <article key={s.periodId}>
          <h4>Revision {s.revisionNumber}</h4>
          <p>{s.snapshot.flatId}: {s.snapshot.volumeMl} mL; total {s.snapshot.totalMinor} paise — fictional fixture, illustrative invoice.</p>
          <button onClick={() => void act(async () => { const detail = await request(`/me/statements/${s.periodId}`) as { snapshot: Statement }; setStatements(old => old.map(item => item.periodId === s.periodId ? { ...item, snapshot: detail.snapshot } : item)); })}>View latest</button>
          <button onClick={() => void act(async () => { const result = await request(`/me/statements/${s.periodId}/explanation`) as Explanation; setExplanations(old => ({ ...old, [s.periodId]: result })); })}>Explain fictional bill</button>
          {explanation && <p>{explanation.summary} Current total: {explanation.currentTotalMinor} paise{explanation.previousTotalMinor ? `; prior total: ${explanation.previousTotalMinor} paise` : ''}. Source: {explanation.source === 'fallback' ? 'deterministic explanation' : explanation.source === 'cache' ? 'validated cached explanation' : 'validated Groq selection'}.</p>}
        </article>;
      })}
    </div>}
    {error && <p role="alert">{error}</p>}
  </section></main>;
}

