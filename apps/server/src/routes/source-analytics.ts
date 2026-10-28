import { Router } from 'express';
import type pg from 'pg';
import { ADAPTER_VERSION, ARCHIVE_SHA256 } from '@water/shared/hsb';

type Row = { doi: string; dataset_version: string; licence: string; source_unit_assumption: string; event_count: string; apartment_count: string; event_volume_ml: string; first_event_at: Date | null; last_event_at: Date | null; last_imported_at: Date | null };
export function sourceAnalyticsRoutes(pool: pg.Pool) {
  const router = Router();
  router.get('/summary', async (_req, res) => {
    try {
      const result = await pool.query<Row>(`SELECT m.doi,m.dataset_version,m.licence,m.source_unit_assumption,
        count(e.id)::text AS event_count,count(DISTINCT e.apartment)::text AS apartment_count,
        coalesce(sum(e.volume_ml),0)::text AS event_volume_ml,
        min(e.event_at) AS first_event_at,max(e.event_at) AS last_event_at,max(e.imported_at) AS last_imported_at
        FROM app.source_manifests m LEFT JOIN app.source_events e ON e.source_manifest_id=m.id
        WHERE m.doi='10.5281/zenodo.22076411' AND m.dataset_version='1.1.0' AND m.archive_sha256=$1 AND m.adapter_version=$2
        GROUP BY m.id ORDER BY m.created_at DESC LIMIT 1`, [ARCHIVE_SHA256, ADAPTER_VERSION]);
      const row = result.rows[0];
      if (!row) { res.json({ provenance: 'observed_source_event_analytics', status: 'no_verified_import', eventCount: '0', eventVolumeMl: '0', coverageCertified: false }); return; }
      res.json({ provenance: 'observed_source_event_analytics', status: 'available', datasetDoi: row.doi, datasetVersion: row.dataset_version, licence: row.licence, sourceUnitAssumption: row.source_unit_assumption, eventCount: row.event_count, apartmentCount: row.apartment_count, eventVolumeMl: row.event_volume_ml, firstEventAt: row.first_event_at?.toISOString() ?? null, lastEventAt: row.last_event_at?.toISOString() ?? null, lastImportedAt: row.last_imported_at?.toISOString() ?? null, coverageCertified: false });
    } catch { res.status(503).json({ error: 'source_analytics_unavailable' }); }
  });
  return router;
}
