import { Router } from 'express';
import type pg from 'pg';

export function healthRoutes(pool: pg.Pool) {
  const router = Router();
  router.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  router.get('/readyz', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ status: 'ok' }); }
    catch { res.locals.failureCategory = 'database_unavailable'; res.status(503).json({ error: 'database_unavailable' }); }
  });
  return router;
}

