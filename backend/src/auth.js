const { createHash } = require('node:crypto');

const verifiedTokens = new Map();
const pendingTokens = new Map();
const CACHE_LIMIT = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AVATARS = new Set([
  '/assets/lawyer-cat-transparent.png',
  '/assets/court/opponent-cat.webp',
  '/assets/evidence/tenant-cat-transparent.webp',
  '/assets/evidence/landlord-cat-transparent.webp',
]);

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function config() {
  return {
    url: String(process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    anonKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  };
}

function normalizeUsername(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : '';
}

function legacyUsernameEmail(username) {
  return 'u-' + [...normalizeUsername(username).toLowerCase()].map((char) => char.codePointAt(0).toString(16)).join('-') + '@argus.local';
}

function usernameEmail(username) {
  const canonical = normalizeUsername(username).toLowerCase();
  const encoded = legacyUsernameEmail(username).split('@')[0];
  // Preserve existing identities; long Unicode usernames otherwise exceed the
  // email local-part limit of 64 characters used by the Auth provider.
  const localPart = encoded.length <= 64 ? encoded : createHash('sha256').update(canonical).digest('hex');
  return localPart + '@argus.local';
}

// user_metadata is user-editable: only the verified Auth email owns a username.
function identityUsername(user) {
  const displayName = normalizeUsername(user.user_metadata?.username);
  if (/^[a-f0-9]{64}@argus\.local$/i.test(user.email || '') && /^[\p{L}\p{N}_-]{2,20}$/u.test(displayName) && usernameEmail(displayName) === user.email.toLowerCase()) return displayName;
  const match = /^u-([0-9a-f-]+)@argus\.local$/i.exec(user.email || '');
  if (!match) throw httpError(409, '账号缺少有效的用户名身份，请联系管理员');
  let decoded;
  try { decoded = String.fromCodePoint(...match[1].split('-').map((part) => parseInt(part, 16))); }
  catch { throw httpError(409, '账号用户名身份无效'); }
  if (!/^[\p{L}\p{N}_-]{2,20}$/u.test(decoded) || legacyUsernameEmail(decoded) !== user.email.toLowerCase()) {
    throw httpError(409, '账号用户名身份无效');
  }
  return /^[\p{L}\p{N}_-]{2,20}$/u.test(displayName) && legacyUsernameEmail(displayName) === user.email.toLowerCase() ? displayName : decoded;
}

function bearerToken(req) {
  const value = req.headers.authorization;
  if (!value) return '';
  const match = typeof value === 'string' && /^Bearer ([A-Za-z0-9_.-]+)$/i.exec(value);
  if (!match || value.length > 8192) throw httpError(401, '登录凭证格式无效');
  return match[1];
}

async function fetchJson(url, init, fetchImpl) {
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    return { response, body };
  } catch {
    throw httpError(503, '账号服务暂时不可用，请稍后重试');
  }
}

async function verifySupabaseToken(token, fetchImpl = fetch) {
  if (!token || token.length > 8192) throw httpError(401, '请先登录');
  let claims;
  try {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
    claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  } catch { throw httpError(401, '登录凭证格式无效'); }
  // Decoding is only an early rejection/expiry bound. Supabase verifies the signature.
  if (!claims || !Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= Date.now() || !UUID.test(claims.sub) || claims.role !== 'authenticated') {
    throw httpError(401, '登录状态已失效，请重新登录');
  }
  const { url, anonKey } = config();
  if (!url || !anonKey) throw httpError(503, '服务端尚未配置 Supabase');
  const key = createHash('sha256').update(url + '\0' + anonKey + '\0' + token).digest('hex');
  const cached = verifiedTokens.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  verifiedTokens.delete(key);
  if (pendingTokens.has(key)) return pendingTokens.get(key);
  if (pendingTokens.size >= CACHE_LIMIT) throw httpError(503, '账号服务繁忙，请稍后重试');
  const pending = (async () => {
    const { response, body } = await fetchJson(url + '/auth/v1/user', { headers: { apikey: anonKey, Authorization: 'Bearer ' + token } }, fetchImpl);
    if (response.status === 401 || response.status === 403) throw httpError(401, '登录状态已失效，请重新登录');
    if (!response.ok) throw httpError(503, '账号服务暂时不可用，请稍后重试');
    if (!body || !UUID.test(body.id) || body.id !== claims.sub || claims.exp * 1000 <= Date.now()) throw httpError(401, '登录凭证无效');
    const user = { id: body.id, email: body.email, username: identityUsername(body) };
    for (const [entry, value] of verifiedTokens) if (value.expiresAt <= Date.now()) verifiedTokens.delete(entry);
    if (verifiedTokens.size >= CACHE_LIMIT) verifiedTokens.delete(verifiedTokens.keys().next().value);
    verifiedTokens.set(key, { user, expiresAt: Math.min(Date.now() + 60_000, claims.exp * 1000) });
    return user;
  })();
  pendingTokens.set(key, pending);
  try { return await pending; } finally { pendingTokens.delete(key); }
}

async function requireSession(req) {
  const user = await verifySupabaseToken(bearerToken(req));
  return { user, profileId: user.id };
}

async function serviceRequest(path, init = {}, fetchImpl = fetch) {
  const { url, serviceKey } = config();
  if (!url || !serviceKey) throw httpError(503, '服务端尚未配置 Supabase 数据访问权限');
  const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json', ...init.headers };
  const { response, body } = await fetchJson(url + path, { ...init, headers }, fetchImpl);
  if (!response.ok) {
    if (response.status === 409 || body?.code === '23505') throw httpError(409, '用户名已被使用或记录存在冲突');
    if (body?.code === '23503') throw httpError(409, '账号档案尚未建立，请重新登录后重试');
    throw httpError(503, '账号数据服务暂时不可用，请稍后重试');
  }
  return body;
}

async function saveProfile(session, profile = {}, fetchImpl = fetch) {
  if (profile.avatar !== undefined && !AVATARS.has(profile.avatar)) throw httpError(400, '请选择有效的预设头像');
  // IDs, names, scores and completion counts from the request are never forwarded.
  const result = await serviceRequest('/rest/v1/rpc/save_player_profile', {
    method: 'POST', body: JSON.stringify({ p_player_id: session.profileId, p_name: session.user.username, p_avatar: profile.avatar ?? null }),
  }, fetchImpl);
  return profileRow(result, session.profileId);
}

function profileRow(result, expectedId) {
  // PostgREST composite-returning RPCs can represent a single row as an array.
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || row.id !== expectedId) throw httpError(503, '账号档案响应无效，请稍后重试');
  return row;
}

async function loadProfile(session, fetchImpl = fetch) {
  const rows = await serviceRequest('/rest/v1/player_profiles?id=eq.' + encodeURIComponent(session.profileId) + '&select=id,name,avatar,total_score,completed_levels', {}, fetchImpl);
  return rows.length ? profileRow(rows, session.profileId) : saveProfile(session, {}, fetchImpl);
}

async function isUsernameAvailable(username, fetchImpl = fetch) {
  const clean = normalizeUsername(username);
  if (!/^[\p{L}\p{N}_-]{2,20}$/u.test(clean) || !/^[\p{L}\p{N}_-]{2,20}$/u.test(clean.toLowerCase())) return false;
  const email = usernameEmail(clean);
  const check = (identity) => serviceRequest('/rest/v1/rpc/is_username_available', {
    method: 'POST', body: JSON.stringify({ p_name: clean, p_email: identity }),
  }, fetchImpl);
  const available = await check(email);
  // Some earlier Auth installations accepted long local parts. Reserve those
  // accounts too, including users who have not created a profile yet.
  return available && email !== legacyUsernameEmail(clean) ? check(legacyUsernameEmail(clean)) : available;
}

async function recordCampaignWin(session, levelId, score, fetchImpl = fetch) {
  const result = await serviceRequest('/rest/v1/rpc/record_campaign_win', { method: 'POST', body: JSON.stringify({ p_player_id: session.profileId, p_level_id: levelId, p_score: score }) }, fetchImpl);
  return profileRow(result, session.profileId);
}

module.exports = { bearerToken, httpError, identityUsername, isUsernameAvailable, loadProfile, recordCampaignWin, requireSession, saveProfile, serviceRequest, verifySupabaseToken };
