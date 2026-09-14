import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

export type PlayerProfile = {
  id: string;
  name: string;
  avatar: string;
  totalScore: number;
  completedLevels: number;
  completedLevelIds?: number[]; // Local practice only; never uploaded.
};

export type LeaderboardEntry = PlayerProfile & { rank: number };
export type AuthUser = { id: string; email?: string; username?: string };
export type BattleProof = { ticket: string; actions: Array<string | null> };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const supabase: SupabaseClient | null = supabaseUrl && supabasePublicKey ? createClient(supabaseUrl, supabasePublicKey) : null;
export const isSupabaseConfigured = Boolean(supabase);
const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || '/argus-api').replace(/\/$/, '');
const AUTH_EMAIL_DOMAIN = 'argus.local';

export function normalizeUsername(value: string): string { return value.normalize('NFKC').trim(); }

function legacyUsernameEmail(username: string): string {
  return 'u-' + [...normalizeUsername(username).toLowerCase()].map((char) => char.codePointAt(0)!.toString(16)).join('-') + '@' + AUTH_EMAIL_DOMAIN;
}

async function usernameEmail(username: string): Promise<string> {
  const canonical = normalizeUsername(username).toLowerCase();
  const legacy = legacyUsernameEmail(username);
  if (legacy.split('@')[0].length <= 64) return legacy;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}@${AUTH_EMAIL_DOMAIN}`;
}

function fromAuthUser(user: User): AuthUser {
  return { id: user.id, email: user.email, username: typeof user.user_metadata?.username === 'string' ? user.user_metadata.username : undefined };
}

async function getAccessToken(expectedUserId?: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (expectedUserId && data.session?.user.id !== expectedUserId) throw new Error('账号已切换，请重试');
  return data.session?.access_token || null;
}

export async function requestJson<T>(path: string, init: RequestInit = {}, expectedUserId?: string): Promise<T> {
  const base = new URL(apiBaseUrl + '/', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  const target = new URL(apiBaseUrl + path, base.origin);
  if (!path.startsWith('/api/') || target.origin !== base.origin || !target.pathname.startsWith(base.pathname + 'api/')) throw new Error('无效的 API 地址');
  const route = path.split('?')[0];
  const protectedRoute = ['/api/profile', '/api/campaign/runs', '/api/campaign/battles'].includes(route) || (route === '/api/community/posts' && init.method === 'POST');
  const token = protectedRoute ? await getAccessToken(expectedUserId) : null;
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  headers.delete('Authorization');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const timeout = AbortSignal.timeout(12_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const response = await fetch(target, { ...init, credentials: 'omit', redirect: 'error', signal, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || '请求失败');
  return (body.data !== undefined ? body.data : body) as T;
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const body = await requestJson<{ available: boolean }>(`/api/auth/username-available?username=${encodeURIComponent(normalizeUsername(username))}`);
  return body.available;
}

export async function registerAccount(username: string, password: string): Promise<{ user: AuthUser | null; needsEmailConfirmation: boolean }> {
  if (!supabase) throw new Error('请先配置 Supabase URL 和 anon key');
  const cleanUsername = normalizeUsername(username);
  if (!/^[\p{L}\p{N}_-]{2,20}$/u.test(cleanUsername) || !/^[\p{L}\p{N}_-]{2,20}$/u.test(cleanUsername.toLowerCase())) throw new Error('用户名格式无效');
  if (password.length < 8 || password.length > 72) throw new Error('密码需要 8 到 72 位');
  const { data, error } = await supabase.auth.signUp({ email: await usernameEmail(cleanUsername), password, options: { data: { username: cleanUsername } } });
  if (error) throw error;
  return { user: data.user ? fromAuthUser(data.user) : null, needsEmailConfirmation: !data.session };
}

export async function loginAccount(username: string, password: string): Promise<AuthUser> {
  if (!supabase) throw new Error('请先配置 Supabase URL 和 anon key');
  const email = await usernameEmail(username);
  let result = await supabase.auth.signInWithPassword({ email, password });
  const legacy = legacyUsernameEmail(username);
  if (email !== legacy && result.error?.code === 'invalid_credentials') {
    result = await supabase.auth.signInWithPassword({ email: legacy, password });
  }
  const { data, error } = result;
  if (error || !data.user) throw error || new Error('登录失败，请检查用户名和密码');
  return fromAuthUser(data.user);
}

export async function logoutAccount(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function onAuthChange(callback: (user: AuthUser | null) => void): () => void {
  if (!supabase) return () => undefined;
  let active = true;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    // SDK callbacks run under its auth lock; defer any work that calls getSession.
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (active) callback(session?.user ? fromAuthUser(session.user) : null);
    }, 0);
    timers.add(timer);
  });
  return () => {
    active = false;
    for (const timer of timers) clearTimeout(timer);
    data.subscription.unsubscribe();
  };
}

export function getPlayerId(): string {
  if (typeof window === 'undefined') return '';
  const key = 'argus-player-id';
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const id = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `00000000-0000-4000-8000-${Math.floor(Math.random() * 0xffffffffffff).toString(16).padStart(12, '0')}`;
  window.localStorage.setItem(key, id);
  return id;
}

function fromRow(row: Record<string, unknown>): PlayerProfile {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    avatar: String(row.avatar || '/assets/lawyer-cat-transparent.png'),
    totalScore: Number(row.total_score || 0),
    completedLevels: Number(row.completed_levels || 0),
  };
}

export async function loadPlayerProfile(id: string): Promise<PlayerProfile | null> {
  if (!id) return null;
  if (!supabase) return readLocalProfile(id);
  const row = await requestJson<Record<string, unknown> | null>('/api/profile', {}, id);
  if (row && row.id !== id) throw new Error('账号档案不匹配，请重试');
  return row ? fromRow(row) : null;
}

export function loadLocalPlayerProfile(id: string): PlayerProfile | null { return readLocalProfile(id); }

export async function savePlayerProfile(profile: PlayerProfile): Promise<PlayerProfile> {
  if (!supabase) {
    if (typeof window !== 'undefined') window.localStorage.setItem(`argus-profile:${profile.id}`, JSON.stringify(profile));
    return profile;
  }
  const row = await requestJson<Record<string, unknown>>('/api/profile', { method: 'PUT', body: JSON.stringify({ avatar: profile.avatar }) }, profile.id);
  if (row.id !== profile.id) throw new Error('账号档案不匹配，请重试');
  return fromRow(row);
}

export async function saveCampaignRun(proof: BattleProof, playerId: string): Promise<PlayerProfile> {
  const body = await requestJson<{ profile: Record<string, unknown> }>('/api/campaign/runs', { method: 'POST', body: JSON.stringify(proof) }, playerId);
  if (body.profile?.id !== playerId) throw new Error('账号档案不匹配，请重试');
  return fromRow(body.profile);
}

export async function loadLeaderboard(limit = 8): Promise<LeaderboardEntry[]> {
  const rows = await requestJson<Record<string, unknown>[]>(`/api/leaderboard?limit=${Math.min(50, Math.max(1, limit))}`);
  return rows.map((row, index) => ({ ...fromRow(row), rank: index + 1 }));
}

function readLocalProfile(id: string): PlayerProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`argus-profile:${id}`);
    return raw ? JSON.parse(raw) as PlayerProfile : null;
  } catch { return null; }
}
