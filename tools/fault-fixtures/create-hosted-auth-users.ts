import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

loadEnvFile('.env');
const env = z.object({
  HOSTED_SUPABASE: z.literal('true'),
  VITE_SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(20)
}).parse(process.env);
const client = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const users = [
  { label: 'MANAGER', id: 'DEMO_MANAGER_AUTH_ID' },
  { label: 'A', id: 'DEMO_A_AUTH_ID' },
  { label: 'B', id: 'DEMO_B_AUTH_ID' }
] as const;
if (users.every(({ id }) => process.env[id])) {
  console.log('Three fictional Auth UUIDs already recorded; no users created');
  process.exit(0);
}
for (const { label, id } of users) {
  if (process.env[id]) continue;
  const emailKey = `DEMO_${label}_EMAIL`;
  const passwordKey = `DEMO_${label}_PASSWORD`;
  if (!process.env[emailKey] || !process.env[passwordKey]) {
    const suffix = randomBytes(6).toString('hex');
    const email = `fictional-water-${label.toLowerCase()}-${suffix}@example.com`;
    const password = randomBytes(32).toString('base64url');
    appendFileSync('.env', `\n${emailKey}=${email}\n${passwordKey}=${password}\n`, { mode: 0o600 });
    process.env[emailKey] = email;
    process.env[passwordKey] = password;
  }
  const { data, error } = await client.auth.admin.createUser({
    email: process.env[emailKey]!, password: process.env[passwordKey]!, email_confirm: true
  });
  if (error || !data.user) throw new Error(`Supabase Auth creation failed for fictional ${label}: ${error?.status ?? 'unknown status'} ${error?.code ?? 'unknown code'}`);
  appendFileSync('.env', `\n${id}=${data.user.id}\n`, { mode: 0o600 });
  process.env[id] = data.user.id;
  console.log(`Created fictional ${label} Auth user; UUID recorded in ignored .env`);
}
