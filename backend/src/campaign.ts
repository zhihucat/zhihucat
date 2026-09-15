import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { campaignCases } from './campaign-cases.ts';
import { actionSeed, battleReducer, emptyBattle, evidenceStats, HAND_SIZE, opponentHealth } from './court-battle.mts';
import { httpError } from './auth.ts';
import { isRecord, isStringArray } from './types.ts';
import type { BattleStart, BattleTicket, CampaignCase, JsonObject, PublicCampaignCase } from './types.ts';

// A dedicated key permits stateless tickets across replicas. In local/demo mode
// a restart intentionally invalidates outstanding games, never existing scores.
const battleSigningKey = process.env.CAMPAIGN_SIGNING_KEY || randomBytes(32);
if (typeof battleSigningKey === 'string' && battleSigningKey.length < 32) throw new Error('CAMPAIGN_SIGNING_KEY must be at least 32 characters');
const BATTLE_TTL_MS = 30 * 60_000;

function signBattle(payload: string) {
  return createHmac('sha256', battleSigningKey).update(payload).digest();
}

export function createBattle(input: JsonObject, profileId: string | null = null, now = Date.now()): BattleStart {
  const caseData = resolveCase(input.caseId);
  const ids = input.evidenceIds;
  const requiredCount = caseData.source ? HAND_SIZE : 1;
  if (!isStringArray(ids) || ids.length < requiredCount || ids.length > HAND_SIZE || new Set(ids).size !== ids.length || ids.some((id) => !caseData.evidence.some((item) => item.id === id))) {
    throw httpError(400, caseData.source ? '故事案卷必须选择 4 张不同的本关证据卡' : '请选择 1 到 4 张本关证据卡');
  }
  const seed = randomInt(0x100000000);
  const ticket: BattleTicket = { v: 1, profileId, caseId: caseData.id, evidenceIds: ids, seed, expiresAt: now + BATTLE_TTL_MS };
  const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url');
  return { ticket: `${payload}.${signBattle(payload).toString('base64url')}`, seed };
}

export function replayBattle(input: JsonObject, profileId?: string | null, now = Date.now()) {
  if (typeof input.ticket !== 'string' || input.ticket.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input.ticket)) throw httpError(400, '缺少有效的开局凭证，请重新开始本关');
  const [payload, signature] = input.ticket.split('.');
  const expected = signBattle(payload);
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw httpError(400, '开局凭证无效');
  // Only this server's signed payload reaches the internal ticket type.
  const game = JSON.parse(Buffer.from(payload, 'base64url').toString()) as BattleTicket;
  if (game.v !== 1 || game.expiresAt <= now) throw httpError(409, '本局已过期，请重新开始本关');
  if (profileId !== undefined && game.profileId !== profileId) throw httpError(403, '只能结算当前账号登录后开始的对局');
  if (!Array.isArray(input.actions) || !input.actions.length || input.actions.length > 200) throw httpError(400, '出牌记录无效');
  const actions: unknown[] = input.actions;
  const caseData = resolveCase(game.caseId);
  const deck = game.evidenceIds.map((id) => {
    const item = caseData.evidence.find((evidence) => evidence.id === id);
    if (!item) throw httpError(409, '本关证据已更新，请重新开始本关');
    const key = caseData.keyEvidenceIds.includes(id);
    return { id: `card-${id}`, evidenceId: id, name: item.title, nature: '', key, credibility: item.credibility, text: '', effectText: '', staminaRecovery: 0, shieldGain: 0, ...evidenceStats(item, key, caseData.levelId) };
  });
  const enemyHp = opponentHealth(caseData);
  let state = battleReducer(emptyBattle(enemyHp), {
    type: 'start', deck, selectedIds: game.evidenceIds, enemyHp, seed: game.seed,
    requireAllEvidence: Boolean(caseData.source),
  });
  for (const [index, cardId] of actions.entries()) {
    if (state.result || (cardId !== null && (typeof cardId !== 'string' || cardId.length > 120))) throw httpError(400, '出牌记录包含无效操作');
    const next = cardId === null
      ? battleReducer(state, { type: 'opponent', levelId: caseData.levelId, timeout: true })
      : battleReducer(state, { type: 'play', cardId, seed: actionSeed(game.seed, index) });
    if (next === state) throw httpError(400, '出牌不在手牌中或体力不足');
    // Counterattacks and resource accounting cannot be skipped by the client.
    state = cardId === null ? next : battleReducer(next, { type: 'opponent', levelId: caseData.levelId });
    state = battleReducer(state, { type: 'next' });
  }
  if (!state.result) throw httpError(400, '对局尚未结束，不能结算');
  return buildVerdict({ caseId: game.caseId, evidenceIds: game.evidenceIds, gameResult: state.result });
}

export const demoCase = campaignCases[0];
const dynamicCases = new Map<string, CampaignCase>();

function resolveCase(identifier: unknown): CampaignCase {
  // Omitted IDs keep the original demo API compatible. Explicit unknown IDs never fall back.
  if (identifier === undefined || identifier === null) return demoCase;
  const selected = dynamicCases.get(String(identifier))
    || campaignCases.find((item) => item.id === identifier || String(item.levelId) === String(identifier));
  if (!selected) {
    throw httpError(404, '关卡不存在，请从关卡地图重新选择');
  }
  return selected;
}

export function getCampaignLevels() {
  return campaignCases.map(({ id, levelId, levelTitle, desc, difficulty, goal, keyEvidenceIds }) => ({
    id, levelId, title: levelTitle, desc, difficulty, goal, keyEvidenceCount: keyEvidenceIds.length,
  }));
}

export function getCampaignCase(identifier?: unknown): PublicCampaignCase {
  const { judgment, adversary, keywords, ...caseData } = resolveCase(identifier);
  return structuredClone(caseData);
}

export function registerCampaignCase(candidate: unknown): PublicCampaignCase {
  if (!isRecord(candidate) || typeof candidate.id !== 'string' || !candidate.id || !Array.isArray(candidate.evidence)) {
    throw httpError(500, '动态案卷格式异常');
  }
  const caseData = candidate as CampaignCase;
  const existing = dynamicCases.get(caseData.id);
  const upgradesToLive = existing?.source?.mode !== 'zhihu-live' && caseData.source?.mode === 'zhihu-live';
  if (!existing || upgradesToLive) dynamicCases.set(caseData.id, structuredClone(caseData));
  const { judgment, adversary, keywords, ...publicCase } = caseData;
  return structuredClone(publicCase);
}

function selectEvidence(caseData: CampaignCase, input: JsonObject) {
  const ids = new Set<unknown>(Array.isArray(input.evidenceIds) ? input.evidenceIds : []);
  // Unknown IDs, duplicates and evidence from other levels cannot earn points or complete a chain.
  return caseData.evidence.filter((item) => ids.has(item.id));
}

export function respondToDebate(input: JsonObject) {
  const caseData = resolveCase(input.caseId ?? input.levelId);
  const argument = String(input.argument || '').trim();
  if (!argument) {
    throw httpError(400, 'argument 不能为空');
  }
  if (argument.length > 2000) {
    throw httpError(400, 'argument 不能超过 2000 个字符');
  }
  const evidence = selectEvidence(caseData, input);
  const evidenceIds = evidence.map((item) => item.id);
  const missing = caseData.keyEvidenceIds.filter((id) => !evidenceIds.includes(id));
  const history = Array.isArray(input.history) ? input.history.slice(-20).filter((turn: unknown) => isRecord(turn) && (!turn.caseId || turn.caseId === caseData.id)) : [];
  const matches = caseData.keywords.map((words) => words.filter((word) => argument.includes(word)).length);
  const coverage = matches.filter(Boolean).length;
  const topic = Math.max(...matches) > 0 ? matches.indexOf(Math.max(...matches)) : history.length % caseData.focus.length;
  const linkedTitles = evidence.slice(0, 2).map((item) => `“${item.title}”`).join('、');
  const missingTitles = caseData.evidence.filter((item) => missing.includes(item.id)).map((item) => item.title);
  const response = evidence.length
    ? `对方代理人：已收到${linkedTitles}。${caseData.adversary[topic]}`
    : `对方代理人：关于“${caseData.focus[topic]}”，目前只是单方陈述，请提交能定位到原件的本案证据。`;
  const judge = !evidence.length
    ? '当前未出示有效的本关证据，不能以其他案件的材料替代举证。'
    : `本轮围绕“${caseData.focus[topic]}”。${coverage ? `已关联${coverage}项争点。` : '论点尚未具体回应本案争点。'}${missing.length ? `尚缺关键材料：${missingTitles.join('、')}。` : '关键材料已齐备，仍须解释其与请求的关联及证明力。'}`;
  const scoreChange = evidence.length ? Math.min(30, 2 + evidence.length * 3 + coverage * 4) : -7;
  const won = missing.length === 0 && coverage >= 2;
  const turn = {
    id: randomUUID(), caseId: caseData.id, speaker: 'opponent', argument, evidenceIds,
    response, judge, scoreChange, createdAt: new Date().toISOString(),
  };
  return {
    caseId: caseData.id, levelId: caseData.levelId, turn, response, judge, scoreChange,
    opponentScoreChange: won ? -18 : scoreChange > 10 ? -6 : 2,
    nextPrompt: won ? '关键证据链已闭合，可以请求训练裁决。' : `请继续围绕“${caseData.focus[topic]}”补充原件和论证。`,
    status: won ? 'ready_for_verdict' : 'in_progress', historyCount: history.length + 1,
  };
}

function resolveGameResult(input: JsonObject) {
  const gameResult = input.gameResult ?? input.result ?? input.outcome;
  if (gameResult !== 'player_win' && gameResult !== 'opponent_win') {
    throw httpError(400, 'gameResult 必须是 player_win 或 opponent_win');
  }
  return gameResult;
}

export function buildVerdict(input: JsonObject) {
  const caseData = resolveCase(input.caseId ?? input.levelId);
  const gameResult = resolveGameResult(input);
  const evidence = selectEvidence(caseData, input);
  const chain = evidence.filter((item) => caseData.keyEvidenceIds.includes(item.id)).map((item) => `${item.title}：${item.proofPurpose}`);
  const playerWon = gameResult === 'player_win';
  const score = playerWon ? 88 : 0;
  return {
    caseId: caseData.id, levelId: caseData.levelId, gameResult,
    status: gameResult,
    winner: playerWon
      ? (caseData.judgment.playerWinner || `${caseData.playerSide}（本局胜诉）`)
      : (caseData.judgment.opponentWinner || `${caseData.opponentSide}（本局胜诉）`),
    score,
    award: playerWon ? caseData.judgment.award : (caseData.judgment.lossAward || `训练裁决：本局游戏结果判定${caseData.opponentSide}胜诉，${caseData.playerSide}的请求不获支持。`),
    chain: chain.length ? chain : ['尚无可核验的本关关键证据'],
    reasoning: `${playerWon ? caseData.judgment.reasoning : (caseData.judgment.lossReasoning || '本局游戏结果显示对方先取得胜利。')}${caseData.judgment.resultNote || '最终裁决依据本局游戏结果，而不是证据是否齐全；证据链仅用于展示本局的举证过程。'}`,
    sources: caseData.judgment.sources,
    source: caseData.source ? structuredClone(caseData.source) : undefined,
    disclaimer: caseData.judgment.disclaimer || '虚构案件的规则化训练反馈，不是真实法院或仲裁机构裁决，不构成法律意见。',
  };
}
