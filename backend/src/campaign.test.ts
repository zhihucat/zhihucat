import assert from 'node:assert/strict';
import test from 'node:test';
import { createBattle, replayBattle, getCampaignCase, registerCampaignCase } from './campaign.ts';
import { actionSeed, battleReducer, canAffordCard, emptyBattle, evidenceStats, opponentHealth } from './court-battle.mts';
import { createServer } from './server.ts';
import { buildBlueBloodCase } from './zhihu-story.ts';
import { responseJson, serverUrl } from './test-helpers.ts';
import type { ApiData } from './test-helpers.ts';
import type { BattleStart, PublicCampaignCase } from './types.ts';

function playGame(caseData: PublicCampaignCase, game: BattleStart, evidenceIds: string[]) {
  const enemyHp = opponentHealth(caseData);
  const deck = evidenceIds.map((id) => {
    const item = caseData.evidence.find((evidence) => evidence.id === id);
    assert.ok(item);
    const key = caseData.keyEvidenceIds.includes(id);
    return { id: `card-${id}`, evidenceId: id, name: item.title, nature: '', credibility: item.credibility, text: '', effectText: '', key, staminaRecovery: 0, ...evidenceStats(item, key, caseData.levelId) };
  });
  let state = battleReducer(emptyBattle(enemyHp), {
    type: 'start', deck, selectedIds: evidenceIds, enemyHp, seed: game.seed,
    requireAllEvidence: Boolean(caseData.source),
  });
  const actions: string[] = [];
  while (!state.result && actions.length < 100) {
    const playable = state.hand.filter((card) => canAffordCard(card, state.stamina, state.playerShield));
    const card = playable.find((item) => item.value > 0) || playable.find((item) => item.staminaRecovery > 0) || playable[0];
    assert.ok(card);
    state = battleReducer(state, { type: 'play', cardId: card.id, seed: actionSeed(game.seed, actions.length) });
    actions.push(card.id);
    state = battleReducer(state, { type: 'opponent', levelId: caseData.levelId });
    state = battleReducer(state, { type: 'next' });
  }
  assert.ok(state.result);
  return { proof: { ticket: game.ticket, actions }, state };
}

test('all twenty cases replay the same outcome as the client with server-owned stats and random draws', () => {
  for (let levelId = 1; levelId <= 20; levelId++) {
    const caseData = getCampaignCase(levelId);
    const evidenceIds = caseData.keyEvidenceIds.slice(0, 4);
    const game = createBattle({ caseId: caseData.id, evidenceIds }, 'owner');
    const { proof, state } = playGame(caseData, game, evidenceIds);
    const verdict = replayBattle(proof, 'owner');
    assert.equal(verdict.gameResult, state.result);
    assert.equal(verdict.levelId, levelId);
    assert.equal(verdict.score, state.result === 'player_win' ? 88 : 0);
  }
});

test('partial evidence can legitimately win; invented scores, levels and results have no effect', () => {
  const caseData = getCampaignCase(1);
  const evidenceIds = caseData.keyEvidenceIds.slice(0, 3);
  const game = createBattle({ caseId: caseData.id, evidenceIds }, 'owner');
  const { proof, state } = playGame(caseData, game, evidenceIds);
  assert.equal(state.result, 'player_win');
  const verdict = replayBattle({ ...proof, gameResult: 'opponent_win', score: 99999, levelId: 20 }, 'owner');
  assert.equal(verdict.gameResult, 'player_win');
  assert.equal(verdict.score, 88);
  assert.equal(verdict.levelId, 1);
  assert.throws(() => replayBattle({ ...proof, actions: proof.actions.slice(0, 1) }, 'owner'), { statusCode: 400 });
  assert.throws(() => replayBattle({ ...proof, actions: [...proof.actions, null] }, 'owner'), { statusCode: 400 });
});

test('Blue Blood requires four distinct exhibits and server replay enforces the complete selected chain', () => {
  registerCampaignCase(buildBlueBloodCase({}, 'curated-fallback'));
  const caseData = getCampaignCase('zhihu-story-2025684191967294692');
  assert.ok(caseData.source);
  assert.ok(caseData.hypothesisEvidenceIds?.length);
  assert.throws(() => createBattle({ caseId: caseData.id, evidenceIds: caseData.keyEvidenceIds }), { statusCode: 400 });

  const evidenceIds = [...caseData.keyEvidenceIds, caseData.hypothesisEvidenceIds[0]];
  const game = createBattle({ caseId: caseData.id, evidenceIds }, 'story-player');
  const { proof, state } = playGame(caseData, game, evidenceIds);
  assert.equal(state.result, 'player_win');
  assert.deepEqual(new Set(state.playedEvidenceIds), new Set(evidenceIds));

  const verdict = replayBattle(proof, 'story-player');
  assert.equal(verdict.gameResult, 'player_win');
  assert.equal(verdict.caseId, caseData.id);
  assert.equal(verdict.source?.mode, 'curated-fallback');
  assert.match(verdict.disclaimer, /知乎故事公开接口片段/);
});

test('story battle keeps one HP until every selected exhibit has been played', () => {
  const evidenceIds = ['story-e1', 'story-e2', 'story-e3', 'story-e4'];
  const deck = evidenceIds.map((evidenceId) => ({
    id: `card-${evidenceId}`, evidenceId, name: evidenceId, nature: '故事证据', key: true,
    value: 10, credibility: 9, text: '', cost: 0, effectText: '', staminaRecovery: 0,
  }));
  let state = battleReducer(emptyBattle(10), {
    type: 'start', deck, selectedIds: evidenceIds, enemyHp: 10, seed: 42, requireAllEvidence: true,
  });
  const first = state.hand.find((card) => card.evidenceId === evidenceIds[0]);
  assert.ok(first);
  state = battleReducer(state, { type: 'play', cardId: first.id, seed: 43 });
  assert.equal(state.enemyHp, 1);
  assert.equal(state.result, null);

  for (const evidenceId of evidenceIds.slice(1)) {
    const card = state.hand.find((item) => item.evidenceId === evidenceId);
    assert.ok(card);
    state = battleReducer({ ...state, stage: 'player' }, { type: 'play', cardId: card.id, seed: 44 });
  }
  assert.equal(state.enemyHp, 0);
  assert.equal(state.result, 'player_win');
  assert.deepEqual(new Set(state.playedEvidenceIds), new Set(evidenceIds));
});

test('tickets bind the account, case, evidence, expiry and seed', () => {
  const caseData = getCampaignCase(1);
  const evidenceIds = caseData.keyEvidenceIds.slice(0, 3);
  const game = createBattle({ caseId: caseData.id, evidenceIds }, 'owner', 1000);
  const { proof } = playGame(caseData, game, evidenceIds);
  assert.throws(() => replayBattle(proof, 'other', 1001), { statusCode: 403 });
  assert.throws(() => replayBattle(proof, 'owner', 1_801_000), { statusCode: 409 });
  const [payload, signature] = game.ticket.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
  for (const changes of [{ profileId: 'other' }, { seed: 1 }, { caseId: 'fake' }, { expiresAt: Number.MAX_SAFE_INTEGER }, { evidenceIds: ['invented'] }]) {
    const changed = Buffer.from(JSON.stringify({ ...decoded, ...changes })).toString('base64url');
    assert.throws(() => replayBattle({ ...proof, ticket: changed + '.' + signature }, 'owner', 1001), { statusCode: 400 });
  }
  const guest = createBattle({ caseId: caseData.id, evidenceIds });
  assert.throws(() => replayBattle({ ...proof, ticket: guest.ticket }, 'owner'), { statusCode: 403 });
});

test('invalid evidence, illegal plays, missing actions and fabricated wins are rejected', () => {
  const caseData = getCampaignCase(1);
  for (const evidenceIds of [[], ['invented'], [caseData.keyEvidenceIds[0], caseData.keyEvidenceIds[0]], caseData.evidence.map((item) => item.id)]) {
    assert.throws(() => createBattle({ caseId: caseData.id, evidenceIds }), { statusCode: 400 });
  }
  const game = createBattle({ caseId: caseData.id, evidenceIds: caseData.keyEvidenceIds });
  for (const actions of [[], ['invented-card'], [{}], Array(201).fill(null)]) assert.throws(() => replayBattle({ ticket: game.ticket, actions }), { statusCode: 400 });
  assert.throws(() => replayBattle({ gameResult: 'player_win', score: 88 }), { statusCode: 400 });
  const lost = replayBattle({ ticket: game.ticket, actions: Array(10).fill(null), gameResult: 'player_win' });
  assert.equal(lost.gameResult, 'opponent_win');
  assert.equal(lost.score, 0);
});

test('public start and verdict HTTP routes accept a real replay, never a claimed outcome alone', async (t) => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve()); }));
  const base = serverUrl(server);
  const post = async (route: string, body: unknown) => fetch(base + '/api/campaign/' + route, { method: 'POST', body: JSON.stringify(body) });
  const caseData = getCampaignCase(1);
  const start = await post('battles', { caseId: caseData.id, evidenceIds: caseData.keyEvidenceIds });
  assert.equal(start.status, 201);
  const { data: game } = await responseJson<ApiData<BattleStart>>(start);
  const { proof } = playGame(caseData, game, caseData.keyEvidenceIds);
  const result = await post('verdict', proof);
  assert.equal(result.status, 200);
  assert.equal((await responseJson<ApiData<ReturnType<typeof replayBattle>>>(result)).data.gameResult, 'player_win');
  assert.equal((await post('verdict', { gameResult: 'player_win', evidenceIds: caseData.keyEvidenceIds })).status, 400);
});
