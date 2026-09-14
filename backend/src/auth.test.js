const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const test = require('node:test');
const { bearerToken, identityUsername, isUsernameAvailable, loadProfile, saveProfile, serviceRequest, verifySupabaseToken } = require('./auth');
const { createServer } = require('./server');

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'u-63-61-74@argus.local', user_metadata: { username: 'Cat' } };
const session = { profileId: user.id, user: { ...user, username: 'Cat' } };
const avatar = '/assets/lawyer-cat-transparent.png';
const token = (overrides = {}) => ['e30', Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, ...overrides })).toString('base64url'), 'test-signature'].join('.');
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

function configure(t) {
  const values = { SUPABASE_URL: `https://${randomUUID()}.example.invalid`, SUPABASE_ANON_KEY: 'test-public-key', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_SERVICE_ROLE_KEY: 'test-server-only-key' };
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

test('missing, malformed, expired and service-role credentials fail before any upstream call', async (t) => {
  configure(t);
  const upstream = () => assert.fail('must not contact Supabase');
  for (const value of ['', 'abc', 'x.null.y', token({ exp: 1 }), token({ sub: 'other' }), token({ role: 'service_role' })]) {
    await assert.rejects(verifySupabaseToken(value, upstream), { statusCode: 401 });
  }
  assert.equal(bearerToken({ headers: {} }), '');
  assert.equal(bearerToken({ headers: { authorization: 'bearer abc.def.ghi' } }), 'abc.def.ghi');
  for (const value of ['Basic xyz', 'Bearer abc def', 'Bearer ']) assert.throws(() => bearerToken({ headers: { authorization: value } }), { statusCode: 401 });
});

test('only remote-verified subjects are trusted; verification never sends service credentials', async (t) => {
  configure(t);
  let calls = 0;
  const signed = token();
  const fetchImpl = async (url, init) => {
    calls++;
    assert.equal(url, process.env.SUPABASE_URL + '/auth/v1/user');
    assert.equal(init.headers.apikey, 'test-public-key');
    assert.equal(init.headers.Authorization, 'Bearer ' + signed);
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    return response(user);
  };
  assert.equal((await verifySupabaseToken(signed, fetchImpl)).id, user.id);
  await verifySupabaseToken(signed, fetchImpl);
  assert.equal(calls, 1);
  await assert.rejects(verifySupabaseToken(token({ nonce: 1 }), async () => response({ ...user, id: randomUUID() })), { statusCode: 401 });
  await assert.rejects(verifySupabaseToken(token({ nonce: 2 }), async () => response({ message: 'invalid signature' }, 401)), { statusCode: 401 });
});

test('cached acceptance never crosses JWT expiration, and a token expiring in flight is rejected', async (t) => {
  configure(t);
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const signed = token({ exp: Math.floor(now / 1000) + 2 });
  await verifySupabaseToken(signed, async () => response(user));
  now += 3000;
  await assert.rejects(verifySupabaseToken(signed, () => assert.fail('expired cache must be rejected')), { statusCode: 401 });
  const pending = token({ exp: Math.floor(now / 1000) + 2 });
  await assert.rejects(verifySupabaseToken(pending, async () => { now += 3000; return response(user); }), { statusCode: 401 });
});

test('concurrent checks deduplicate; transient upstream errors do not poison the cache', async (t) => {
  configure(t);
  let calls = 0;
  const signed = token();
  const fetchImpl = async () => { calls++; await Promise.resolve(); return response(user); };
  await Promise.all(Array.from({ length: 20 }, () => verifySupabaseToken(signed, fetchImpl)));
  assert.equal(calls, 1);
  const other = token({ nonce: 'retry' });
  for (const failure of [async () => response({}, 500), async () => { throw new Error('network secret'); }, async () => new Response('not json')]) {
    await assert.rejects(verifySupabaseToken(other, failure), (error) => error.statusCode === 503 && !error.message.includes('secret'));
  }
  assert.equal((await verifySupabaseToken(other, fetchImpl)).id, user.id);
});

test('verification cache has a fixed bound and refreshes after 60 seconds', async (t) => {
  configure(t);
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  const upstream = async () => { calls++; return response(user); };
  const first = token({ nonce: 0 });
  for (let i = 0; i < 1025; i++) await verifySupabaseToken(token({ nonce: i }), upstream);
  await verifySupabaseToken(first, upstream);
  assert.equal(calls, 1026, 'oldest token was evicted');
  now += 60_001;
  await verifySupabaseToken(first, upstream);
  assert.equal(calls, 1027);
});

test('mutable metadata cannot impersonate another username', () => {
  assert.equal(identityUsername(user), 'Cat');
  assert.equal(identityUsername({ ...user, user_metadata: { username: 'administrator' } }), 'cat');
  assert.throws(() => identityUsername({ ...user, email: 'someone@example.com' }), { statusCode: 409 });
  assert.throws(() => identityUsername({ ...user, email: 'u-ffffffff@argus.local' }), { statusCode: 409 });
});

test('long Unicode names bind their hash identity without exceeding email local-part limits', () => {
  const name = '猫'.repeat(20);
  const email = createHash('sha256').update(name).digest('hex') + '@argus.local';
  assert.equal(identityUsername({ ...user, email, user_metadata: { username: name } }), name);
  const legacy = 'u-' + Array(20).fill('732b').join('-') + '@argus.local';
  assert.equal(identityUsername({ ...user, email: legacy, user_metadata: { username: name } }), name);
  assert.throws(() => identityUsername({ ...user, email, user_metadata: { username: 'Another' } }), { statusCode: 409 });
});

test('profile initialization and avatar writes only use verified identity; scores are never rewritten', async (t) => {
  configure(t);
  const calls = [];
  const upstream = async (url, init) => {
    calls.push({ url, init });
    return response(init.method === 'POST' ? { id: user.id, name: 'Cat', total_score: 0 } : []);
  };
  const profile = await loadProfile(session, upstream);
  assert.equal(profile.total_score, 0);
  assert.equal(calls.length, 2);
  await saveProfile(session, { id: randomUUID(), name: 'Victim', avatar, totalScore: 999999, completedLevels: 99 }, upstream);
  const body = JSON.parse(calls.at(-1).init.body);
  assert.deepEqual(body, { p_player_id: user.id, p_name: 'Cat', p_avatar: avatar });
  for (const invalid of ['//evil.example/avatar.png', '/anything.svg', 'data:image/png,x', null, {}]) {
    await assert.rejects(saveProfile(session, { avatar: invalid }, upstream), { statusCode: 400 });
  }
});

test('single-row PostgREST arrays initialize a profile and invalid RPC rows fail closed', async (t) => {
  configure(t);
  const row = { id: user.id, name: 'Cat', avatar, total_score: 0 };
  assert.deepEqual(await loadProfile(session, async (_url, init) => response(init.method === 'POST' ? [row] : [])), row);
  await assert.rejects(saveProfile(session, {}, async () => response([])), { statusCode: 503 });
  await assert.rejects(saveProfile(session, {}, async () => response({ ...row, id: randomUUID() })), { statusCode: 503 });
});

test('username availability uses exact RPC values, including underscores, and rejects invalid input', async (t) => {
  configure(t);
  const available = await isUsernameAvailable(' A_B ', async (url, init) => {
    assert.match(url, /\/rpc\/is_username_available$/);
    assert.deepEqual(JSON.parse(init.body), { p_name: 'A_B', p_email: 'u-61-5f-62@argus.local' });
    return response(true);
  });
  assert.equal(available, true);
  assert.equal(await isUsernameAvailable('%', () => assert.fail('invalid name')), false);
});

test('database errors and credentials are not returned to clients', async (t) => {
  configure(t);
  await assert.rejects(serviceRequest('/rest/v1/player_profiles', {}, async () => response({ message: 'SQL detail test-server-only-key' }, 500)), (error) => error.statusCode === 503 && !/SQL|key/.test(error.message));
  await assert.rejects(serviceRequest('/rest/v1/player_profiles', {}, async () => response({ code: '23505', message: 'private row' }, 409)), { statusCode: 409 });
});

async function serve(t, options = {}) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('bad origins are contained by the handler and preflight requires an allowed origin', async (t) => {
  const base = await serve(t, { corsOrigin: 'https://app.example.com' });
  for (const method of ['POST', 'OPTIONS']) {
    const result = await fetch(base + '/api/profile', { method, headers: { Origin: 'https://evil.example.com' } });
    assert.equal(result.status, 403);
    assert.equal(result.headers.get('access-control-allow-origin'), null);
  }
  const allowed = await fetch(base + '/api/profile', { method: 'OPTIONS', headers: { Origin: 'https://app.example.com' } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-credentials'), null);
  assert.equal((await fetch(base + '/health')).status, 200);
});

test('invalid JSON shapes and oversized bodies are rejected without breaking the server', async (t) => {
  const base = await serve(t);
  for (const body of ['null', '[]', '42', '"text"']) {
    assert.equal((await fetch(base + '/api/cases/draft', { method: 'POST', body })).status, 400);
  }
  const oversized = await fetch(base + '/api/cases/draft', { method: 'POST', body: JSON.stringify({ concept: 'x'.repeat(3 * 1024 * 1024) }) });
  assert.equal(oversized.status, 413);
  assert.equal((await fetch(base + '/health')).status, 200);
});

test('start requests are rate limited and forged forwarding headers do not bypass it', async (t) => {
  const base = await serve(t);
  for (let i = 0; i < 31; i++) {
    const result = await fetch(base + '/api/campaign/battles', {
      method: 'POST', body: '{}', headers: { 'X-Forwarded-For': `203.0.113.${i + 1}` },
    });
    assert.equal(result.status, i < 30 ? 400 : 429);
  }
});

test('protected routes reject unauthenticated requests, and custom auth routes are absent', async (t) => {
  const base = await serve(t);
  for (const [route, method] of [['/api/profile', 'GET'], ['/api/profile', 'PUT'], ['/api/campaign/runs', 'POST'], ['/api/community/posts', 'POST']]) {
    const result = await fetch(base + route, { method, ...(method !== 'GET' ? { body: JSON.stringify({ title: 'post', body: 'body' }) } : {}) });
    assert.equal(result.status, 401, route);
  }
  for (const route of ['/api/auth/signup', '/api/auth/login', '/api/auth/logout', '/api/auth/zhihu/start']) assert.equal((await fetch(base + route, { method: 'POST' })).status, 404);
});

test('HTTP profile and settlement boundary ignores forged IDs, usernames and scores', async (t) => {
  configure(t);
  const base = await serve(t);
  const nativeFetch = global.fetch;
  const serviceBodies = [];
  t.mock.method(global, 'fetch', async (url, init = {}) => {
    if (!String(url).startsWith(process.env.SUPABASE_URL)) return nativeFetch(url, init);
    if (String(url).endsWith('/auth/v1/user')) return response(user);
    if (init.body) serviceBodies.push(JSON.parse(init.body));
    return response({ id: user.id, name: 'Cat', avatar, total_score: 88, completed_levels: 1 });
  });
  const result = await fetch(base + '/api/profile', { method: 'PUT', headers: { Authorization: 'Bearer ' + token() }, body: JSON.stringify({ id: randomUUID(), name: 'Victim', avatar, total_score: 999999 }) });
  assert.equal(result.status, 200);
  assert.deepEqual(serviceBodies, [{ p_player_id: user.id, p_name: 'Cat', p_avatar: avatar }]);
  const forged = await fetch(base + '/api/campaign/runs', { method: 'POST', headers: { Authorization: 'Bearer ' + token() }, body: JSON.stringify({ gameResult: 'player_win', caseId: 'rental-deposit-001', levelId: 1, score: 999999 }) });
  assert.equal(forged.status, 400);
  assert.equal(serviceBodies.length, 1, 'no score RPC was invoked');
});
