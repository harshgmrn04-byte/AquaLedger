import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import pg from 'pg';
if (existsSync('.env')) loadEnvFile('.env');
const db = 'water_metering_bench';
const admin = new pg.Client({ host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432), database: 'postgres', user: 'postgres', password: process.env.POSTGRES_PASSWORD });
await admin.connect();
try {
  const found = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [db]);
  if (!found.rowCount) await admin.query(`CREATE DATABASE ${db} OWNER app_migrate`);
  console.log(`Benchmark database ${db} ready`);
} finally { await admin.end(); }
