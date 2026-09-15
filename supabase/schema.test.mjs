// Isolated PostgreSQL verification; never uses Supabase URLs or production keys.
// Run: node --test supabase/schema.test.mjs (Docker required).
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const owner = '00000000-0000-4000-8000-000000000001';
const legacy = '00000000-0000-4000-8000-000000000002';
const avatar = '/assets/lawyer-cat-transparent.png';

test('Supabase schema: safe upgrade, privileges, initialization and concurrent settlement', async (t) => {
  const container = `zhihucat-auth-test-${randomUUID()}`;
  execFileSync('docker', ['run', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine']);
  t.after(() => execFileSync('docker', ['stop', container], { stdio: 'pipe' }));
  for (let attempt = 0; attempt < 100; attempt++) {
    try { execFileSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { stdio: 'pipe' }); break; }
    catch { if (attempt === 99) throw new Error('Test PostgreSQL did not start'); await setTimeout(100); }
  }
  const args = ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'];
  const sql = (input) => execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const query = async (input) => (await exec('docker', [...args, '-c', input])).stdout.trim();
  // Minimal local emulation of Supabase roles and the Auth identity table.
  sql(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text unique);
    insert into auth.users values ('${owner}', 'u-63-61-74@argus.local'), ('${legacy}', 'u-6c-65-67-61-63-79@argus.local');
  `);
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  sql(schema);
  // Earlier prototypes permitted repeat wins. An upgrade must preserve them.
  sql(`select public.save_player_profile('${legacy}', 'Legacy', null);
       update public.player_profiles set total_score = 176, completed_levels = 2 where id = '${legacy}';
       insert into public.campaign_runs(player_id, level_id, score, outcome)
       values ('${legacy}', 1, 88, 'player_win'), ('${legacy}', 1, 88, 'player_win');`);
  sql(schema);

  await t.test('migration is repeatable and preserves historical duplicates and totals', () => {
    assert.equal(sql(`select total_score || ':' || completed_levels from public.player_profiles where id = '${legacy}'`), '176:2');
    assert.equal(sql(`select count(*) from public.campaign_runs where player_id = '${legacy}'`), '2');
  });

  await t.test('anonymous/authenticated clients cannot read private tables, forge scores or invoke privileged RPCs', () => {
    for (const role of ['anon', 'authenticated']) {
      assert.throws(() => sql(`set role ${role}; insert into public.player_profiles(id,name,total_score) values ('${owner}','Forged',99999);`));
      assert.throws(() => sql(`set role ${role}; select * from public.player_profiles;`));
      assert.throws(() => sql(`set role ${role}; select * from public.campaign_runs;`));
      assert.throws(() => sql(`set role ${role}; update public.leaderboard set total_score = 999999 where id = '${legacy}';`));
      assert.throws(() => sql(`set role ${role}; delete from public.leaderboard where id = '${legacy}';`));
      assert.throws(() => sql(`set role ${role}; select public.record_campaign_win('${legacy}',2,88);`));
      assert.throws(() => sql(`set role ${role}; select public.save_player_profile('${owner}','Forged',null);`));
      assert.throws(() => sql(`set role ${role}; select public.is_username_available('cat','u-63-61-74@argus.local');`));
      assert.equal(sql(`set role ${role}; select count(*) from public.leaderboard;`), '1');
    }
  });

  await t.test('new identities initialize once at zero, missing Auth users are rejected, names stay immutable', async () => {
    assert.throws(() => sql(`select public.save_player_profile('00000000-0000-4000-8000-000000000099','Missing',null);`));
    await Promise.all(Array.from({ length: 8 }, () => query(`set role service_role; select public.save_player_profile('${owner}','Cat',null);`)));
    assert.equal(sql(`select total_score || ':' || completed_levels from public.player_profiles where id = '${owner}'`), '0:0');
    sql(`set role service_role; select public.save_player_profile('${owner}','Impersonator','${avatar}');`);
    assert.equal(sql(`select name from public.player_profiles where id = '${owner}'`), 'Cat');
  });

  await t.test('concurrent wins and avatar edits award once without losing increments', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, index) => query(index % 2
      ? `set role service_role; select public.save_player_profile('${owner}','Cat','${avatar}');`
      : `set role service_role; select public.record_campaign_win('${owner}',91,88);`)));
    assert.equal(sql(`select total_score || ':' || completed_levels from public.player_profiles where id = '${owner}'`), '88:1');
    assert.equal(sql(`select count(*) from public.campaign_runs where player_id = '${owner}'`), '1');
    sql(`set role service_role; select public.record_campaign_win('${owner}',91,88);`);
    assert.equal(sql(`select total_score from public.player_profiles where id = '${owner}'`), '88');
    assert.throws(() => sql(`set role service_role; select public.record_campaign_win('${owner}',2,999999);`));
    assert.equal(sql(`select count(*) from public.campaign_runs where player_id = '${owner}'`), '1');
  });

  await t.test('availability is exact and includes Auth accounts without a player profile', () => {
    sql(`insert into auth.users values ('00000000-0000-4000-8000-000000000003','reserved@argus.local');`);
    assert.equal(sql(`select public.is_username_available('CAT','unused@argus.local')`), 'f');
    assert.equal(sql(`select public.is_username_available('c_t','unused@argus.local')`), 't');
    assert.equal(sql(`select public.is_username_available('New','reserved@argus.local')`), 'f');
  });
});
