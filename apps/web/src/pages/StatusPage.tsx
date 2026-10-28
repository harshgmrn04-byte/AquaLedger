import { useEffect, useState } from 'react';
type Summary = { status: string; eventCount: string; apartmentCount?: string; eventVolumeMl: string; firstEventAt?: string | null; lastEventAt?: string | null; lastImportedAt?: string | null };
export function StatusPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => { const base = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3001'; void fetch(`${base}/api/v1/source-events/summary`).then(async response => { if (!response.ok) throw new Error('unavailable'); setSummary(await response.json() as Summary); }).catch(() => setUnavailable(true)); }, []);
  return <section className="source"><h2>Historical HSB source events</h2><p>Published observations from Gothenburg, Sweden, December 2019–January 2023. HSB Living Lab Fixture-Level Household Water Consumption Dataset, version 1.1.0, CC BY 4.0. Source values are interpreted as m³ from aggregate evidence although the dictionary says litres. Events have no certified complete billing period; event sums are analytics only.</p>
    {summary?.status === 'available' && <p>Imported observed events: {summary.eventCount}; apartment pseudonyms: {summary.apartmentCount}; derived event sum: {summary.eventVolumeMl} mL (m³ source-unit inference). Event-time range: {summary.firstEventAt ?? 'none'} to {summary.lastEventAt ?? 'none'} UTC. Last import: {summary.lastImportedAt ?? 'none'} UTC. This sum is not a billable period total.</p>}
    {summary?.status === 'no_verified_import' && <p>No verified historical event import is available on this server.</p>}
    {unavailable && <p>Historical event analytics are temporarily unavailable. Static snapshot: the published HSB 1.1.0 audit found 652,315 positive source events across 28 apartment pseudonyms, with zero coverage-certified billing periods. This is an archive description, not live usage or a resident statement.</p>}
    <p><a href="https://zenodo.org/records/22076411">Dataset and licence</a></p><p>These observed events are separate from the fictional billing walkthrough below.</p></section>;
}

