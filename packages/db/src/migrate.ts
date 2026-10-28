import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { connection } from './config.js';

const client = new pg.Client(connection('app_migrate'));
await client.connect();
try {
  await client.query('CREATE TABLE IF NOT EXISTS app.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const dir = resolve('packages/db/migrations');
  for (const name of readdirSync(dir).filter(x => /^\d+_.+\.sql$/.test(x)).sort()) {
    const found = await client.query('SELECT 1 FROM app.schema_migrations WHERE version = $1', [name]);
    if (found.rowCount) continue;
    await client.query('BEGIN');
    try {
      await client.query(readFileSync(resolve(dir, name), 'utf8'));
      await client.query('INSERT INTO app.schema_migrations(version) VALUES ($1)', [name]);
      await client.query('COMMIT');
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally { await client.end(); }
