import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import pg from 'pg';

if (existsSync('.env')) loadEnvFile('.env');
const db = new pg.Client({ host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432), database: process.env.POSTGRES_DB ?? 'water_metering', user: 'app_migrate', password: process.env.APP_MIGRATE_PASSWORD });
await db.connect();
try {
  await db.query('BEGIN');
  for (const society of ['fictional-demo', 'fictional-isolation']) {
    await db.query("INSERT INTO app.societies(id,timezone,fixture_id) VALUES ($1,'Asia/Kolkata','billing-demo-v1') ON CONFLICT (id) DO NOTHING", [society]);
    for (const flat of ['DEMO_A', 'DEMO_B']) await db.query('INSERT INTO app.flats(society_id,id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [society, flat]);
  }
  const users = [
    ['11111111-1111-4111-8111-111111111111', 'fictional-demo', 'manager', null],
    ['22222222-2222-4222-8222-222222222222', 'fictional-demo', 'resident', 'DEMO_A'],
    ['33333333-3333-4333-8333-333333333333', 'fictional-demo', 'resident', 'DEMO_B'],
    ['44444444-4444-4444-8444-444444444444', 'fictional-isolation', 'manager', null],
    ['55555555-5555-4555-8555-555555555555', 'fictional-isolation', 'resident', 'DEMO_A']
  ];
  for (const user of users) await db.query('INSERT INTO app.profiles(auth_user_id,society_id,role,flat_id) VALUES ($1,$2,$3,$4) ON CONFLICT (auth_user_id) DO NOTHING', user);
  await db.query('COMMIT');
  console.log('Seeded fictional-only societies, flats, and profile IDs. No Auth users or HSB rows were created.');
} catch (error) { await db.query('ROLLBACK'); throw error; } finally { await db.end(); }
