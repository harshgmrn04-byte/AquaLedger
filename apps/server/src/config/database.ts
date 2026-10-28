import pg from 'pg';
import { readFileSync } from 'node:fs';
import type { loadServerEnv } from './env.js';

export function createRuntimePool(env: ReturnType<typeof loadServerEnv>) {
  return new pg.Pool({ host: env.POSTGRES_HOST, port: env.POSTGRES_PORT, database: env.POSTGRES_DB, user: env.POSTGRES_USER, password: env.APP_RW_PASSWORD, ssl: env.POSTGRES_SSL === 'require' ? { rejectUnauthorized: Boolean(env.POSTGRES_CA_PATH), ...(env.POSTGRES_CA_PATH ? { ca: readFileSync(env.POSTGRES_CA_PATH, 'utf8') } : {}) } : false, max: 3, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
}

