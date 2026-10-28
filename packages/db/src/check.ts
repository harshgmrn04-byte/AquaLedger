import pg from 'pg';
import { connection } from './config.js';
const client = new pg.Client(connection('app_rw'));
await client.connect();
try {
  const allowed = await client.query("SELECT has_schema_privilege(current_user, 'app', 'USAGE') AS app_usage, has_schema_privilege(current_user, 'app', 'CREATE') AS app_create, has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage, has_database_privilege(current_user, current_database(), 'CREATE') AS db_create");
  const row = allowed.rows[0];
  if (!row.app_usage || row.app_create || (process.env.HOSTED_SUPABASE !== 'true' && row.public_usage) || row.db_create) throw new Error('Runtime role grants are too broad');
  if (process.env.HOSTED_SUPABASE === 'true') {
    const exposure = await client.query("SELECT has_schema_privilege('anon','app','USAGE') AS anon,has_schema_privilege('authenticated','app','USAGE') AS authenticated,has_schema_privilege('service_role','app','USAGE') AS service_role");
    if (exposure.rows[0]?.anon || exposure.rows[0]?.authenticated || exposure.rows[0]?.service_role) throw new Error('Data API roles can use app schema');
  }
  await client.query('SELECT count(*) FROM app.source_events');
  try { await client.query('CREATE TABLE app.forbidden_probe(id integer)'); throw new Error('Runtime role created table'); }
  catch (error) { if (error instanceof Error && error.message === 'Runtime role created table') throw error; }
  console.log(process.env.HOSTED_SUPABASE === 'true' ? 'Hosted runtime role limited; Data API roles cannot use app schema' : 'Runtime role can read app data and cannot create tables or use public schema');
} finally { await client.end(); }
