import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';
if (existsSync('.env')) loadEnvFile('.env');
export const config = z.object({
  POSTGRES_HOST: z.string().default('127.0.0.1'),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  POSTGRES_DB: z.string().regex(/^[a-z][a-z0-9_]*$/).default('water_metering'),
  POSTGRES_OWNER_USER: z.string().min(1).default('postgres'),
  POSTGRES_MIGRATE_USER: z.string().min(1).default('app_migrate'),
  POSTGRES_USER: z.string().min(1).default('app_rw'),
  POSTGRES_SSL: z.enum(['disable', 'require']).default('disable'),
  POSTGRES_CA_PATH: z.string().optional(),
  POSTGRES_PASSWORD: z.string().min(12).optional(),
  APP_MIGRATE_PASSWORD: z.string().min(12),
  APP_RW_PASSWORD: z.string().min(12)
}).parse(process.env);
export function connection(user: 'postgres' | 'app_migrate' | 'app_rw') {
  const selectedUser = user === 'postgres' ? config.POSTGRES_OWNER_USER : user === 'app_migrate' ? config.POSTGRES_MIGRATE_USER : config.POSTGRES_USER;
  return {
    host: config.POSTGRES_HOST,
    port: config.POSTGRES_PORT,
    database: config.POSTGRES_DB,
    user: selectedUser,
    password: user === 'postgres' ? config.POSTGRES_PASSWORD : user === 'app_migrate' ? config.APP_MIGRATE_PASSWORD : config.APP_RW_PASSWORD,
    ssl: config.POSTGRES_SSL === 'require' ? { rejectUnauthorized: Boolean(config.POSTGRES_CA_PATH), ...(config.POSTGRES_CA_PATH ? { ca: readFileSync(config.POSTGRES_CA_PATH, 'utf8') } : {}) } : false,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000
  };
}
