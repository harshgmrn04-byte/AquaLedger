import pg from 'pg';
import { config, connection } from './config.js';

const client = new pg.Client(connection('postgres'));
await client.connect();
try {
  for (const [role, password] of [['app_migrate', config.APP_MIGRATE_PASSWORD], ['app_rw', config.APP_RW_PASSWORD]] as const) {
    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    if (!exists.rowCount) await client.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    const quoted = await client.query<{ sql: string }>('SELECT format($1, $2::text, $3::text) AS sql', ['ALTER ROLE %I PASSWORD %L', role, password]);
    await client.query(quoted.rows[0]!.sql);
  }
  await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await client.query('REVOKE CREATE ON DATABASE ' + config.POSTGRES_DB + ' FROM PUBLIC');
  await client.query('GRANT CONNECT ON DATABASE ' + config.POSTGRES_DB + ' TO app_migrate, app_rw');
  await client.query('GRANT CREATE ON DATABASE ' + config.POSTGRES_DB + ' TO app_migrate');
  await client.query('CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION app_migrate');
  await client.query('ALTER SCHEMA app OWNER TO app_migrate');
  await client.query('GRANT USAGE ON SCHEMA app TO app_rw');
  console.log('Database roles and private schema ready');
} finally { await client.end(); }
