import express from 'express';
import type { IngestConfig } from './config/types.js';
import { errorHandler } from './middleware/errors.js';
import { requestContext } from './middleware/request-context.js';
import { healthRoutes } from './routes/health.js';
import { sourceEventRoutes } from './routes/source-events.js';
import { loadArchive, loadSensorMap } from './services/archive.js';
import { billingRoutes } from './billing/api.js';
import { sourceAnalyticsRoutes } from './routes/source-analytics.js';

export { bodySchema } from './schemas/ingestion.js';
export { loadArchive } from './services/archive.js';
export type { IngestConfig } from './config/types.js';

export async function createIngestApp(config: IngestConfig) {
  const archiveHashes = await loadArchive(config.csvPath);
  const sensorMap = loadSensorMap(config.profilePath);
  const log = config.log ?? ((entry: Record<string, unknown>) => process.stdout.write(JSON.stringify(entry) + '\n'));
  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext(log));
  if (config.webOrigin) app.use((req, res, next) => { if (req.header('origin') === config.webOrigin) { res.setHeader('Access-Control-Allow-Origin', config.webOrigin!); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS'); } if (req.method === 'OPTIONS') { res.status(204).end(); return; } next(); });
  app.use(healthRoutes(config.pool));
  if (config.demoReadOnly) app.use((req, res, next) => { if (req.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { res.status(403).json({ error: 'demo_read_only' }); return; } next(); });
  app.use('/api/v1/source-events/batches', sourceEventRoutes({ pool: config.pool, credential: config.credential, archiveHashes, sensorMap, log }));
  app.use('/api/v1/source-events', sourceAnalyticsRoutes(config.pool));
  if (config.billing) app.use('/api/v1', express.json({ limit: '32kb' }), billingRoutes({ pool: config.pool, ...config.billing }));
  app.use(errorHandler);
  return app;
}

