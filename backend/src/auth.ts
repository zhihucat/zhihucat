import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isRecord } from './types.ts';
import type { HttpError, JsonObject, PlayerProfile, Session, VerifiedUser } from './types.ts';

export type FetchJson = (url: string, init: RequestInit) => Promise<Response>;
type AuthRequest = Pick<IncomingMessage, 'headers'>;

const verifiedTokens = new Map<string, { user: VerifiedUser; expiresAt: number }>();
const pendingTokens = new Map<string, Promise<VerifiedUser>>();
const CACHE_LIMIT = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AVATARS = new Set([
  '/assets/lawyer-cat-transparent.png',
  '/assets/court/opponent-cat.webp',
  '/assets/evidence/tenant-cat-transparent.webp',
  '/assets/evidence/landlord-cat-transparent.webp',
]);

export function httpError(statusCode: number, message: string): HttpError {
  return Object.assign(new Error(message), { statusCode });
}

function config() {
  return {
    url: String(process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    anonKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  };
}

function normalizeUsername(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : '';
}

function legacyUsernameEmail(username: string): string {
  return 'u-' + [...normalizeUsername(username).toLowerCase()].map((char) => char.codePointAt(0)!.toString(16)).join('-') + '@argus.local';
}

function usernameEmail(username: string): string {
  const canonical = normalizeUsername(username).toLowerCase();
  const encoded = legacyUsernameEmail(username).split('@')[0];
  // Preserve existing identities; long Unicode usernames otherwise exceed the
  // email local-part limit of 64 characters used by the Auth provider.
  const localPart = encoded.length <= 64 ? encoded : createHash('sha256').update(canonical).digest('hex');
  return localPart + '@argus.local';
}

// user_metadata is user-editable: only the verified Auth email owns a username.
export function identityUsername(user: JsonObject): string {
  const email = typeof user.email === 'string' ? user.email : '';
  const displayName = normalizeUsername(isRecord(user.user_metadata) ? user.user_metadata.username : undefined);
  if (/^[a-f0-9]{64}@argus\.local$/i.test(email) && /^[\p{L}\p{N}_-]{2,20}$/u.test(displayName) && usernameEmail(displayName) === email.toLowerCase()) return displayName;
  const match = /^u-([0-9a-f-]+)@argus\.local$/i.exec(email);
  if (!match) throw httpError(409, '账号缺少有效的用户名身份，请联系管理员');
  let decoded;
  try { decoded = String.fromCodePoint(...match[1].split('-').map((part) => parseInt(part, 16))); }
  catch { throw httpError(409, '账号用户名身份无效'); }
  if (!/^[\p{L}\p{N}_-]{2,20}$/u.test(decoded) || legacyUsernameEmail(decoded) !== email.toLowerCase()) {
    throw httpError(409, '账号用户名身份无效');
  }
  return /^[\p{L}\p{N}_-]{2,20}$/u.test(displayName) && legacyUsernameEmail(displayName) === email.toLowerCase() ? displayName : decoded;
}

export function bearerToken(req: AuthRequest): string {
  const value = req.headers.authorization;
  if (!value) return '';
  const match = typeof value === 'string' && /^Bearer ([A-Za-z0-9_.-]+)$/i.exec(value);
  if (!match || value.length > 8192) throw httpError(401, '登录凭证格式无效');
  return match[1];
}

async function fetchJson(url: string, init: RequestInit, fetchImpl: FetchJson) {
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) });
    const body: unknown = await response.json();
    return { response, body };
  } catch {
    throw httpError(503, '账号服务暂时不可用，请稍后重试');
  }
}

export async function verifySupabaseToken(token: string, fetchImpl: FetchJson = fetch): Promise<VerifiedUser> {
  if (!token || token.length > 8192) throw httpError(401, '请先登录');
  let claims: unknown;
  try {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
    claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  } catch { throw httpError(401, '登录凭证格式无效'); }
  // Decoding is only an early rejection/expiry bound. Supabase verifies the signature.
  if (!isRecord(claims) || typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= Date.now() || typeof claims.sub !== 'string' || !UUID.test(claims.sub) || claims.role !== 'authenticated') {
    throw httpError(401, '登录状态已失效，请重新登录');
  }
  const { exp, sub } = claims;
  const { url, anonKey } = config();
  if (!url || !anonKey) throw httpError(503, '服务端尚未配置 Supabase');
  const key = createHash('sha256').update(url + '\0' + anonKey + '\0' + token).digest('hex');
  const cached = verifiedTokens.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  verifiedTokens.delete(key);
  const existing = pendingTokens.get(key);
  if (existing) return existing;
  if (pendingTokens.size >= CACHE_LIMIT) throw httpError(503, '账号服务繁忙，请稍后重试');
  const pending = (async () => {
    const { response, body } = await fetchJson(url + '/auth/v1/user', { headers: { apikey: anonKey, Authorization: 'Bearer ' + token } }, fetchImpl);
    if (response.status === 401 || response.status === 403) throw httpError(401, '登录状态已失效，请重新登录');
    if (!response.ok) throw httpError(503, '账号服务暂时不可用，请稍后重试');
    if (!isRecord(body) || typeof body.id !== 'string' || !UUID.test(body.id) || body.id !== sub || typeof body.email !== 'string' || exp * 1000 <= Date.now()) throw httpError(401, '登录凭证无效');
    const user = { id: body.id, email: body.email, username: identityUsername(body) };
    for (const [entry, value] of verifiedTokens) if (value.expiresAt <= Date.now()) verifiedTokens.delete(entry);
    const oldest = verifiedTokens.keys().next();
    if (verifiedTokens.size >= CACHE_LIMIT && !oldest.done) verifiedTokens.delete(oldest.value);
    verifiedTokens.set(key, { user, expiresAt: Math.min(Date.now() + 60_000, exp * 1000) });
    return user;
  })();
  pendingTokens.set(key, pending);
  try { return await pending; } finally { pendingTokens.delete(key); }
}

export async function requireSession(req: AuthRequest): Promise<Session> {
  const user = await verifySupabaseToken(bearerToken(req));
  return { user, profileId: user.id };
}

export async function serviceRequest(path: string, init: RequestInit = {}, fetchImpl: FetchJson = fetch): Promise<unknown> {
  const { url, serviceKey } = config();
  if (!url || !serviceKey) throw httpError(503, '服务端尚未配置 Supabase 数据访问权限');
  const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json', ...init.headers };
  const { response, body } = await fetchJson(url + path, { ...init, headers }, fetchImpl);
  if (!response.ok) {
    const code = isRecord(body) ? body.code : undefined;
    if (response.status === 409 || code === '23505') throw httpError(409, '用户名已被使用或记录存在冲突');
    if (code === '23503') throw httpError(409, '账号档案尚未建立，请重新登录后重试');
    throw httpError(503, '账号数据服务暂时不可用，请稍后重试');
  }
  return body;
}

export async function saveProfile(session: Session, profile: JsonObject = {}, fetchImpl: FetchJson = fetch): Promise<PlayerProfile> {
  if (profile.avatar !== undefined && (typeof profile.avatar !== 'string' || !AVATARS.has(profile.avatar))) throw httpError(400, '请选择有效的预设头像');
  // IDs, names, scores and completion counts from the request are never forwarded.
  const result = await serviceRequest('/rest/v1/rpc/save_player_profile', {
    method: 'POST', body: JSON.stringify({ p_player_id: session.profileId, p_name: session.user.username, p_avatar: profile.avatar ?? null }),
  }, fetchImpl);
  return profileRow(result, session.profileId);
}

function profileRow(result: unknown, expectedId: string): PlayerProfile {
  // PostgREST composite-returning RPCs can represent a single row as an array.
  const row: unknown = Array.isArray(result) ? result[0] : result;
  if (!isRecord(row) || row.id !== expectedId || typeof row.name !== 'string' || typeof row.avatar !== 'string'
    || typeof row.total_score !== 'number' || typeof row.completed_levels !== 'number') {
    throw httpError(503, '账号档案响应无效，请稍后重试');
  }
  return { ...row, id: expectedId, name: row.name, avatar: row.avatar, total_score: row.total_score, completed_levels: row.completed_levels };
}

export async function loadProfile(session: Session, fetchImpl: FetchJson = fetch): Promise<PlayerProfile> {
  const rows = await serviceRequest('/rest/v1/player_profiles?id=eq.' + encodeURIComponent(session.profileId) + '&select=id,name,avatar,total_score,completed_levels', {}, fetchImpl);
  if (!Array.isArray(rows)) throw httpError(503, '账号档案响应无效，请稍后重试');
  return rows.length ? profileRow(rows, session.profileId) : saveProfile(session, {}, fetchImpl);
}

export async function isUsernameAvailable(username: unknown, fetchImpl: FetchJson = fetch): Promise<boolean> {
  const clean = normalizeUsername(username);
  if (!/^[\p{L}\p{N}_-]{2,20}$/u.test(clean) || !/^[\p{L}\p{N}_-]{2,20}$/u.test(clean.toLowerCase())) return false;
  const email = usernameEmail(clean);
  const check = async (identity: string): Promise<boolean> => {
    const result = await serviceRequest('/rest/v1/rpc/is_username_available', {
      method: 'POST', body: JSON.stringify({ p_name: clean, p_email: identity }),
    }, fetchImpl);
    if (typeof result !== 'boolean') throw httpError(503, '账号数据服务暂时不可用，请稍后重试');
    return result;
  };
  const available = await check(email);
  // Some earlier Auth installations accepted long local parts. Reserve those
  // accounts too, including users who have not created a profile yet.
  return available && email !== legacyUsernameEmail(clean) ? check(legacyUsernameEmail(clean)) : available;
}

export async function recordCampaignWin(session: Session, levelId: number, score: number, fetchImpl: FetchJson = fetch): Promise<PlayerProfile> {
  const result = await serviceRequest('/rest/v1/rpc/record_campaign_win', { method: 'POST', body: JSON.stringify({ p_player_id: session.profileId, p_level_id: levelId, p_score: score }) }, fetchImpl);
  return profileRow(result, session.profileId);
}
