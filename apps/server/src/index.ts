import { createRuntimePool } from './config/database.js';
import { loadServerEnv } from './config/env.js';
import { createHttpLogger } from './config/logger.js';
import { createIngestApp } from './ingest.js';
import { createRemoteJWKSet } from 'jose';

const env = loadServerEnv();
const pool = createRuntimePool(env);
const app = await createIngestApp({ pool, credential: env.INGESTION_CREDENTIAL, csvPath: env.HSB_CSV_PATH, profilePath: env.HSB_PROFILE_PATH, log: createHttpLogger(), webOrigin: env.WEB_ORIGIN, demoReadOnly: env.DEMO_READ_ONLY === 'true', billing: { jwks: createRemoteJWKSet(new URL(env.AUTH_JWKS_URL)), issuer: env.AUTH_ISSUER, audience: env.AUTH_AUDIENCE, ...(env.GROQ_API_KEY ? { groqKey: env.GROQ_API_KEY } : {}) } });
const server = app.listen(env.PORT, '0.0.0.0');
process.on('SIGTERM', () => { server.close(); void pool.end(); });

