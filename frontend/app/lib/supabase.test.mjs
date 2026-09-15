import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

// Explicit test-only configuration. SDK network operations are mocked below.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://auth.example.invalid';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-public-key';
process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.example.invalid';
const { supabase, registerAccount, loginAccount, logoutAccount, onAuthChange, requestJson, loadPlayerProfile, savePlayerProfile, saveCampaignRun, isUsernameAvailable } = await import('./supabase.ts');
const user = { id: 'user-a', email: 'u-63-61-74@argus.local', user_metadata: { username: 'Cat' } };
const session = { user, access_token: 'test-access-token' };

function mockSession(t, value = session) {
  t.mock.method(supabase.auth, 'getSession', async () => ({ data: { session: value }, error: null }));
}

test('Supabase signup receives normalized identity, metadata and password; no backend stores a password', async (t) => {
  t.mock.method(supabase.auth, 'signUp', async (input) => {
    assert.equal(input.email, 'u-63-61-74@argus.local');
    assert.equal(input.password, 'test-password');
    assert.deepEqual(input.options.data, { username: 'Cat' });
    return { data: { user, session }, error: null };
  });
  assert.equal((await registerAccount(' Ｃat ', 'test-password')).needsEmailConfirmation, false);
  await assert.rejects(registerAccount('Cat', 'short'));
  await assert.rejects(registerAccount('bad/name', 'test-password'));
});

test('Supabase login and logout use the SDK and surface failures', async (t) => {
  t.mock.method(supabase.auth, 'signInWithPassword', async (input) => {
    assert.equal(input.email, 'u-63-61-74@argus.local');
    return { data: { user }, error: null };
  });
  assert.equal((await loginAccount('CAT', 'original')).id, user.id);
  t.mock.method(supabase.auth, 'signOut', async () => ({ error: new Error('offline') }));
  await assert.rejects(logoutAccount(), /offline/);
});

test('20-character Unicode usernames use the same bounded email identity as the backend', async (t) => {
  const name = '猫'.repeat(20);
  t.mock.method(supabase.auth, 'signUp', async (input) => {
    assert.equal(input.email, createHash('sha256').update(name).digest('hex') + '@argus.local');
    assert.equal(input.email.split('@')[0].length, 64);
    return { data: { user, session }, error: null };
  });
  await registerAccount(name, 'test-password');
});

test('long Unicode accounts created by the prototype can still log in', async (t) => {
  let calls = 0;
  t.mock.method(supabase.auth, 'signInWithPassword', async (input) => {
    if (++calls === 1) return { data: { user: null }, error: { code: 'invalid_credentials' } };
    assert.equal(input.email, 'u-' + Array(20).fill('732b').join('-') + '@argus.local');
    return { data: { user }, error: null };
  });
  assert.equal((await loginAccount('猫'.repeat(20), 'original')).id, user.id);
  assert.equal(calls, 2);
});

test('auth notifications defer SDK work outside the auth lock and stop after unsubscribe', async (t) => {
  let emit;
  let unsubscribed = false;
  t.mock.method(supabase.auth, 'onAuthStateChange', (callback) => {
    emit = callback;
    return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } };
  });
  const users = [];
  const stop = onAuthChange((value) => users.push(value));
  emit('SIGNED_IN', session);
  assert.equal(users.length, 0, 'callback must not execute under the SDK lock');
  await setTimeout(1);
  assert.equal(users[0].id, user.id);
  emit('SIGNED_OUT', null);
  stop();
  await setTimeout(1);
  assert.equal(users.length, 1);
  assert.ok(unsubscribed);
});

test('API requests scope Bearer tokens to the configured backend and omit cookies and redirects', async (t) => {
  mockSession(t);
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://api.example.invalid/api/profile');
    assert.equal(init.headers.get('Authorization'), 'Bearer test-access-token');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json({ data: { id: user.id } });
  });
  await requestJson('/api/profile');
  for (const path of ['https://evil.example/', '//evil.example/', '/api/../../steal', '/api/%2e%2e/%2e%2e/steal']) await assert.rejects(requestJson(path), /API/);
});

test('public APIs do not access the auth session or leak tokens', async (t) => {
  t.mock.method(supabase.auth, 'getSession', () => assert.fail('public requests must not wait for auth'));
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(init.headers.get('Authorization'), null);
    return Response.json({ data: { available: true } });
  });
  assert.equal(await isUsernameAvailable('Cat'), true);
});

test('profile updates and wins send only avatars or battle proof, never client totals/ownership', async (t) => {
  mockSession(t);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(JSON.parse(init.body));
    const profile = { id: user.id, name: 'Cat', total_score: 88, completed_levels: 1 };
    return Response.json({ data: String(url).endsWith('/runs') ? { profile } : profile });
  });
  const saved = await savePlayerProfile({ id: user.id, name: 'Victim', avatar: '/assets/lawyer-cat-transparent.png', totalScore: 99999, completedLevels: 99 });
  assert.equal(saved.totalScore, 88);
  const proof = { ticket: 'test-ticket', actions: ['card-1'] };
  await saveCampaignRun(proof, user.id);
  assert.deepEqual(calls, [{ avatar: '/assets/lawyer-cat-transparent.png' }, proof]);
});

test('switching accounts blocks stale writes before fetch; failed writes never appear successful', async (t) => {
  mockSession(t, { ...session, user: { ...user, id: 'user-b' } });
  t.mock.method(globalThis, 'fetch', () => assert.fail('stale write must not be sent'));
  await assert.rejects(saveCampaignRun({ ticket: 'x', actions: [] }, user.id), /账号已切换/);
});

test('anonymous sessions cannot load a known user profile and HTTP errors propagate', async (t) => {
  mockSession(t, null);
  await assert.rejects(loadPlayerProfile(user.id), /账号已切换/);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'temporarily unavailable' } }, { status: 503 }));
  await assert.rejects(requestJson('/api/leaderboard'), /temporarily unavailable/);
});
