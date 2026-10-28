import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  POSTGRES_HOST: z.string().default('127.0.0.1'),
  POSTGRES_PORT: z.coerce.number().int().default(5432),
  POSTGRES_DB: z.string().default('water_metering'),
  POSTGRES_USER: z.string().min(1).default('app_rw'),
  POSTGRES_SSL: z.enum(['disable', 'require']).default('disable'),
  POSTGRES_CA_PATH: z.string().optional(),
  APP_RW_PASSWORD: z.string().min(12),
  GROQ_API_KEY: z.string().min(1).optional(),
  DEMO_READ_ONLY: z.enum(['true', 'false']).default('false'),
  INGESTION_CREDENTIAL: z.string().min(32),
  HSB_CSV_PATH: z.string().min(1),
  HSB_PROFILE_PATH: z.string().default('docs/data/hsb-profile.json')
  ,AUTH_ISSUER: z.url(), AUTH_AUDIENCE: z.string().min(1).default('authenticated'), AUTH_JWKS_URL: z.url(), WEB_ORIGIN: z.url().default('http://127.0.0.1:5173')
});

export function loadServerEnv() {
  if (existsSync('.env')) loadEnvFile('.env');
  return envSchema.parse(process.env);
}

