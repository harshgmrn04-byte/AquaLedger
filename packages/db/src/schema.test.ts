import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { connection } from './config.js';

describe('private app schema and source constraints', () => {
  it('limits runtime grants and rejects source-key collisions and invalid volumes', async () => {
    const db = new pg.Client(connection('app_rw'));
    await db.connect();
    try {
      const grants = await db.query("SELECT has_schema_privilege(current_user, 'app', 'USAGE') AS app_usage, has_schema_privilege(current_user, 'app', 'CREATE') AS app_create, has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage");
      expect(grants.rows[0]).toMatchObject({ app_usage: true, app_create: false, public_usage: false });
      const billingGrants = await db.query("SELECT has_table_privilege(current_user,'app.profiles','INSERT') AS profile_insert, has_table_privilege(current_user,'app.statements','UPDATE') AS statement_update, has_column_privilege(current_user,'app.billing_periods','status','UPDATE') AS period_update");
      expect(billingGrants.rows[0]).toMatchObject({ profile_insert: false, statement_update: false, period_update: true });
      const windowGrants = await db.query("SELECT has_column_privilege(current_user,'app.billing_periods','superseded_by_period_id','INSERT') AS bypass_insert, has_column_privilege(current_user,'app.billing_periods','superseded_by_period_id','UPDATE') AS bypass_update");
      expect(windowGrants.rows[0]).toMatchObject({ bypass_insert: false, bypass_update: false });
      await db.query('BEGIN');
      const manifest = await db.query<{ id: string }>("INSERT INTO app.source_manifests(doi,dataset_version,archive_sha256,archive_md5,licence,adapter_version,source_unit_assumption) VALUES ('test:fixture','test','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','test','test','test') RETURNING id");
      const id = manifest.rows[0]!.id;
      const fields = [id, 'csv:2', 'S0001', 'APT_001', 'Toilet', 'cold', '2020-01-01T00:00:00Z', '1000', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'];
      const sql = 'INSERT INTO app.source_events(source_manifest_id,source_row_key,source_sensor_id,apartment,fixture,channel,event_at,volume_ml,row_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id';
      expect((await db.query(sql, fields)).rowCount).toBe(1);
      expect((await db.query(sql, fields)).rowCount).toBe(0);
      const changed = [...fields]; changed[7] = '2000'; changed[8] = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      expect((await db.query(sql, changed)).rowCount).toBe(0);
      const existing = await db.query('SELECT volume_ml, row_sha256 FROM app.source_events WHERE source_manifest_id=$1 AND source_row_key=$2', [id, 'csv:2']);
      expect(existing.rows[0].volume_ml).toBe('1000');
      expect(existing.rows[0].row_sha256).not.toBe(changed[8]);
      await db.query('SAVEPOINT invalid_volume');
      await expect(db.query(sql, [id, 'csv:3', 'S0001', 'APT_001', 'Toilet', 'cold', '2020-01-01T00:10:00Z', '-1', fields[8]])).rejects.toMatchObject({ code: '23514' });
      await db.query('ROLLBACK TO SAVEPOINT invalid_volume');
      await expect(db.query('CREATE TABLE app.denied_test(id int)')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  });
});
