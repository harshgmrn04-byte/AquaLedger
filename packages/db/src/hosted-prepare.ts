import pg from 'pg';
import { config, connection } from './config.js';

// Separate, opt-in Supabase bootstrap. Never changes Supabase's public/auth grants.
if (process.env.HOSTED_SUPABASE !== 'true' || !config.POSTGRES_PASSWORD || config.POSTGRES_SSL !== 'require') throw new Error('Hosted preparation requires HOSTED_SUPABASE=true, owner password and PostgreSQL SSL');
const client = new pg.Client(connection('postgres'));
await client.connect();
try {
  const identity = await client.query<{ name: string }>('SELECT current_user AS name');
  if (!identity.rows[0]?.name.startsWith('postgres')) throw new Error('Expected Supabase project owner');
  await client.query('BEGIN');
  try {
  for (const [name, password] of [['app_migrate', config.APP_MIGRATE_PASSWORD], ['app_rw', config.APP_RW_PASSWORD]] as const) {
    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [name]);
    const sql = await client.query<{ statement: string }>('SELECT format($1,$2::text,$3::text) AS statement', [exists.rowCount ? 'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L' : 'CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', name, password]);
    await client.query(sql.rows[0]!.statement);
  }
  // PostgreSQL 17 gives a non-superuser role creator ADMIN but SET FALSE.
  // Temporarily allow the managed owner to transfer app schema ownership.
  await client.query('GRANT app_migrate TO postgres WITH SET TRUE, INHERIT FALSE');
  await client.query('GRANT CREATE ON DATABASE postgres TO app_migrate');
  await client.query('CREATE SCHEMA IF NOT EXISTS app');
  const owner = await client.query<{ owner: string }>("SELECT nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname='app'");
  if (owner.rows[0]?.owner !== 'postgres' && owner.rows[0]?.owner !== 'app_migrate') throw new Error('Unexpected app schema owner');
  await client.query('REVOKE ALL ON SCHEMA app FROM PUBLIC,anon,authenticated,service_role');
  await client.query('GRANT USAGE ON SCHEMA app TO app_rw');
  await client.query('ALTER SCHEMA app OWNER TO app_migrate');
  await client.query('REVOKE CREATE ON DATABASE postgres FROM app_migrate');
  await client.query('GRANT app_migrate TO postgres WITH SET FALSE, INHERIT FALSE');
  await client.query('GRANT CONNECT ON DATABASE postgres TO app_migrate,app_rw');
  await client.query('COMMIT');
  console.log('Hosted private app schema and two limited roles prepared; public/auth schemas untouched');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
} finally { await client.end(); }
