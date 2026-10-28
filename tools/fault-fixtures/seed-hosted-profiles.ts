import pg from 'pg';
import { z } from 'zod';
import { connection } from '../../packages/db/src/config.js';

const ids = z.object({ DEMO_MANAGER_AUTH_ID: z.uuid(), DEMO_A_AUTH_ID: z.uuid(), DEMO_B_AUTH_ID: z.uuid(), HOSTED_SUPABASE: z.literal('true') }).parse(process.env);
if (new Set([ids.DEMO_MANAGER_AUTH_ID, ids.DEMO_A_AUTH_ID, ids.DEMO_B_AUTH_ID]).size !== 3) throw new Error('Auth UUIDs must be distinct');
const client = new pg.Client(connection('app_migrate'));
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("INSERT INTO app.societies(id,timezone,fixture_id) VALUES ('fictional-demo','Asia/Kolkata','billing-demo-v1') ON CONFLICT (id) DO NOTHING");
  for (const flat of ['DEMO_A', 'DEMO_B']) await client.query("INSERT INTO app.flats(society_id,id) VALUES ('fictional-demo',$1) ON CONFLICT DO NOTHING", [flat]);
  for (const [id, role, flat] of [[ids.DEMO_MANAGER_AUTH_ID, 'manager', null], [ids.DEMO_A_AUTH_ID, 'resident', 'DEMO_A'], [ids.DEMO_B_AUTH_ID, 'resident', 'DEMO_B']] as const) {
    await client.query("INSERT INTO app.profiles(auth_user_id,society_id,role,flat_id) VALUES ($1,'fictional-demo',$2,$3) ON CONFLICT (auth_user_id) DO NOTHING", [id, role, flat]);
    const mapped = await client.query<{ society_id: string; role: string; flat_id: string | null }>('SELECT society_id,role,flat_id FROM app.profiles WHERE auth_user_id=$1', [id]);
    if (mapped.rows[0]?.society_id !== 'fictional-demo' || mapped.rows[0]?.role !== role || mapped.rows[0]?.flat_id !== flat) throw new Error('Existing profile mapping differs');
  }
  await client.query('COMMIT');
  console.log('Mapped three existing fictional Supabase Auth UUIDs to private demo profiles');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
