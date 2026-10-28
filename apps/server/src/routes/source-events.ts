import express, { Router } from 'express';
import type pg from 'pg';
import type { SensorMap } from '@water/shared/hsb';
import { createSourceEventController } from '../controllers/source-events.js';
import { requireIngestionCredential } from '../middleware/ingestion-auth.js';

export function sourceEventRoutes(config: {
  pool: pg.Pool;
  credential: string;
  archiveHashes: Map<number, string>;
  sensorMap: SensorMap;
  log: (entry: Record<string, unknown>) => void;
}) {
  const router = Router();
  router.post('/', requireIngestionCredential(config.credential), express.json({ limit: '1mb', strict: true }), createSourceEventController(config));
  return router;
}

