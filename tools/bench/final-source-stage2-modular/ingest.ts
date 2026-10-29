import express from 'express';
import type { IngestConfig } from './config/types.js';
import { errorHandler } from './middleware/errors.js';
import { requestContext } from './middleware/request-context.js';
import { healthRoutes } from './routes/health.js';
import { sourceEventRoutes } from './routes/source-events.js';
import { loadArchive, loadSensorMap } from './services/archive.js';

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
  app.use(healthRoutes(config.pool));
  app.use('/api/v1/source-events/batches', sourceEventRoutes({ pool: config.pool, credential: config.credential, archiveHashes, sensorMap, log }));
  app.use(errorHandler);
  return app;
}

