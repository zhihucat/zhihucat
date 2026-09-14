import assert from 'node:assert/strict';
import test from 'node:test';
import { auditContract, buildCaseDraft, buildVerdict, createServer } from './server.ts';
import { getCampaignLevels, respondToDebate } from './campaign.ts';
import { responseJson, serverUrl } from './test-helpers.ts';
import type { ApiData, ApiError } from './test-helpers.ts';
import type { BattleStart, PublicCampaignCase } from './types.ts';

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const server = createServer({ corsOrigin: '*' });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = serverUrl(server);

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('GET /health returns the standalone Node.js service status', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await responseJson<{ status: string; service: string; runtime: string }>(response);

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'argus-backend');
    assert.equal(body.runtime, 'node');
  });
});

test('POST /api/cases/draft creates a case draft', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/cases/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concept: '租客退租后房东扣留押金3000元',
        plaintiff: '租客张某',
        defendant: '房东李某',
      }),
    });
    const body = await responseJson<ApiData<ReturnType<typeof buildCaseDraft>>>(response);

    assert.equal(response.status, 201);
    assert.equal(body.data.caseType, '房屋租赁合同纠纷');
    assert.match(body.data.focus[1], /3000元/);
  });
});

test('POST /api/contracts/audit returns rule-based findings', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/contracts/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        position: '乙方',
        text: '乙方应尽快完成交付。如乙方违约，甲方有权没收全部保证金。',
      }),
    });
    const body = await responseJson<ApiData<ReturnType<typeof auditContract>>>(response);

    assert.equal(response.status, 200);
    assert.equal(body.data.summary.position, '乙方');
    assert.ok(body.data.summary.findingCount >= 3);
    assert.ok(body.data.summary.highRiskCount >= 2);
    for (const finding of body.data.findings) {
      assert.ok(finding.law_sources.length > 0);
      for (const source of finding.law_sources) {
        assert.equal(source.url, 'https://www.court.gov.cn/zixun/xiangqing/233181.html');
      }
    }
  });
});

test('invalid JSON returns a 400 response', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/contracts/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    });
    const body = await responseJson<ApiError>(response);

    assert.equal(response.status, 400);
    assert.equal(body.error.message, '请求体必须是有效 JSON 对象');
  });
});

test('comma-separated CORS origins support Vercel production and preview hosts', async () => {
  const server = createServer({ corsOrigin: 'https://argus.vercel.app,https://preview.argus.vercel.app' });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = serverUrl(server);

  try {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'https://preview.argus.vercel.app' },
    });
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://preview.argus.vercel.app');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('GET /api/campaign/demo exposes complete rental evidence sources', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/campaign/demo`);
    const body = await responseJson<ApiData<PublicCampaignCase>>(response);

    assert.equal(response.status, 200);
    assert.equal(body.data.id, 'rental-deposit-001');
    assert.ok(body.data.scenes.length >= 3);
    assert.ok(body.data.documents.every((document) => document.content));
    assert.ok(body.data.evidence.some((evidence) => evidence.sourceRange === '第五条'));
  });
});

test('POST /api/campaign/respond changes response based on evidence actually submitted', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/campaign/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        argument: '入住照片和微信确认都证明墙面划痕在入住前已经存在，维修报价也没有付款凭证。',
        evidenceIds: ['ev-movein-photo', 'ev-chat', 'ev-repair'],
        history: [],
      }),
    });
    const body = await responseJson<ApiData<ReturnType<typeof respondToDebate>>>(response);

    assert.equal(response.status, 200);
    assert.match(body.data.response, /入住照片/);
    assert.ok(body.data.scoreChange > 10);
    assert.equal(body.data.status, 'in_progress');
  });
});

test('POST /api/campaign/verdict rejects client-asserted wins without a signed replay', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/campaign/verdict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evidenceIds: ['ev-movein-photo', 'ev-chat', 'ev-contract', 'ev-repair'], gameResult: 'player_win' }),
    });
    const body = await responseJson<ApiError>(response);

    assert.equal(response.status, 400);
    assert.ok(body.error.message);
  });
});

const historicalLevelTitles = ['押金猎人', '七天无理由', '加班费幽灵', '信息饕餮', '版权窃贼', '竞业锁链', '格式条款恶魔', '仲裁迷宫', '证据湮灭', '终极审判'];
const eazoLevelTitles = ['租赁押金争议', '网购退货之争', '离职工资之争', '购房尾款之争', '转账之争', '装修停工之争', '二手车之争', '验收之争', '理赔之争', '酒局之后'];
const rentalCaseLeakPattern = /eazo-rental-deposit-001|租赁押金争议|墙面划痕是谁造成|租客张某|房东李某/;

type CampaignResponses = {
  respond: ReturnType<typeof respondToDebate>;
  battles: BattleStart;
  verdict: ReturnType<typeof buildVerdict>;
};

async function postCampaign<Route extends keyof CampaignResponses>(baseUrl: string, route: Route, data: unknown) {
  const response = await fetch(`${baseUrl}/api/campaign/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  return { response, body: await responseJson<ApiData<CampaignResponses[Route]>>(response) };
}

test('all twenty native and EAZO levels have distinct, complete and reachable cases', async () => {
  await withServer(async (baseUrl) => {
    const { data: levels } = await responseJson<ApiData<ReturnType<typeof getCampaignLevels>>>(await fetch(`${baseUrl}/api/campaign/levels`));
    assert.deepEqual(levels.slice(0, 10).map((level) => level.title), historicalLevelTitles);
    assert.deepEqual(levels.slice(10).map((level) => level.title), eazoLevelTitles);
    assert.deepEqual(levels.map((level) => level.difficulty), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 1, 2, 3, 4, 5, 5, 6, 7, 8, 8]);
    assert.equal(new Set(levels.map((level) => level.id)).size, 20);
    const allEvidenceIds = new Set<string>();
    for (const level of levels) {
      const response = await fetch(`${baseUrl}/api/campaign/cases/${level.id}`);
      const { data: caseData } = await responseJson<ApiData<PublicCampaignCase & { judgment?: unknown }>>(response);
      assert.equal(response.status, 200);
      assert.equal(caseData.id, level.id);
      assert.equal(caseData.levelId, level.levelId);
      assert.equal(caseData.levelTitle, level.title);
      assert.ok(caseData.title.startsWith(level.title));
      assert.ok(caseData.summary && caseData.goal && caseData.playerSide && caseData.opponentSide);
      assert.equal(caseData.focus.length, 3);
      assert.ok(caseData.scenes.length >= 2);
      assert.equal(caseData.cards.length, 4);
      assert.ok(caseData.cards.every((card) => card.text && card.cost <= 4));
      assert.equal(caseData.keyEvidenceIds.length, level.keyEvidenceCount);
      assert.ok(caseData.keyEvidenceIds.length <= caseData.actionPoints, 'key chain must be attainable within the AP budget');
      assert.equal(caseData.judgment, undefined, 'case endpoint does not leak the verdict');
      const sceneEvidence = new Set(caseData.scenes.flatMap((scene) => scene.hotspots.map((spot) => spot.evidenceId)));
      const documentEvidence = new Set(caseData.documents.flatMap((document) => document.hotspots.map((spot) => spot.evidenceId)));
      const documents = new Map(caseData.documents.map((document) => [document.id, document]));
      for (const evidence of caseData.evidence) {
        assert.ok(!allEvidenceIds.has(evidence.id), 'evidence identifiers must not be shared across cases');
        allEvidenceIds.add(evidence.id);
        assert.ok(sceneEvidence.has(evidence.id));
        assert.ok(documentEvidence.has(evidence.id));
        const source = documents.get(evidence.sourceDocumentId);
        assert.ok(source);
        assert.ok(source.content.includes('虚构训练材料'));
        assert.ok(source.hotspots.some((spot) => spot.evidenceId === evidence.id));
        assert.ok(evidence.sourceRange && evidence.proofPurpose);
      }
      assert.ok([...sceneEvidence, ...documentEvidence, ...caseData.keyEvidenceIds].every((id) => caseData.evidence.some((evidence) => evidence.id === id)));
      const { data: numberedCase } = await responseJson<ApiData<PublicCampaignCase>>(await fetch(`${baseUrl}/api/campaign/cases/${level.levelId}`));
      assert.equal(numberedCase.id, caseData.id);
      if (level.levelId > 1 && level.levelId !== 11) assert.doesNotMatch(JSON.stringify(caseData), rentalCaseLeakPattern);
    }
  });
});

test('all twenty debate APIs and internal verdict templates stay scoped to their case', async () => {
  await withServer(async (baseUrl) => {
    for (let levelId = 1; levelId <= 20; levelId += 1) {
      const { data: caseData } = await responseJson<ApiData<PublicCampaignCase>>(await fetch(`${baseUrl}/api/campaign/cases/${levelId}`));
      const payload = { caseId: caseData.id, evidenceIds: caseData.keyEvidenceIds, gameResult: 'player_win' };
      for (const card of caseData.cards) {
        const { response, body } = await postCampaign(baseUrl, 'respond', { ...payload, argument: card.text });
        assert.equal(response.status, 200);
        assert.equal(body.data.caseId, caseData.id);
        assert.equal(body.data.turn.argument, card.text);
        assert.deepEqual(new Set(body.data.turn.evidenceIds), new Set(caseData.keyEvidenceIds));
        assert.ok(body.data.scoreChange > 10);
        if (levelId > 1 && levelId !== 11) assert.doesNotMatch(body.data.response + body.data.judge, rentalCaseLeakPattern);
      }
      const body = { data: buildVerdict(payload) };
      assert.equal(body.data.caseId, caseData.id);
      assert.equal(body.data.status, 'player_win');
      assert.equal(body.data.gameResult, 'player_win');
      assert.ok(body.data.winner.includes(caseData.playerSide));
      assert.equal(body.data.chain.length, caseData.keyEvidenceIds.length);
      assert.ok(body.data.award && body.data.reasoning && body.data.sources.length);
      for (const source of body.data.sources) {
        assert.equal(source.url, source.title.includes('民法典')
          ? 'https://www.court.gov.cn/zixun/xiangqing/233181.html'
          : 'https://flk.npc.gov.cn/', source.title);
      }
      if (levelId > 1 && levelId !== 11) assert.doesNotMatch(JSON.stringify(body.data), rentalCaseLeakPattern);
      const partial = { data: buildVerdict({ ...payload, evidenceIds: caseData.keyEvidenceIds.slice(1) }) };
      assert.equal(partial.data.status, 'player_win');
      assert.equal(partial.data.gameResult, 'player_win');
      assert.equal(partial.data.score, body.data.score);
      assert.equal(partial.data.winner, body.data.winner);
      assert.equal(partial.data.award, body.data.award);
      assert.ok(partial.data.chain.length < body.data.chain.length);
    }
  });
});

test('unknown levels fail explicitly instead of silently loading the rental demo', async () => {
  await withServer(async (baseUrl) => {
    for (const identifier of ['0', '21', 'unknown-case', 'toString']) {
      assert.equal((await fetch(`${baseUrl}/api/campaign/cases/${identifier}`)).status, 404);
      for (const route of ['respond', 'battles'] as const) {
        const { response } = await postCampaign(baseUrl, route, { caseId: identifier, argument: '本案证据', evidenceIds: ['ev-contract'] });
        assert.equal(response.status, 404);
      }
    }
    assert.equal((await postCampaign(baseUrl, 'respond', { caseId: 'overtime-pay-003', argument: '   ' })).response.status, 400);
  });
});

test('foreign, fabricated and duplicate evidence cannot complete or inflate another case', async () => {
  await withServer(async (baseUrl) => {
    const { data: caseData } = await responseJson<ApiData<PublicCampaignCase>>(await fetch(`${baseUrl}/api/campaign/cases/2`));
    const foreignIds = ['ev-movein-photo', 'ev-chat', 'ev-contract', 'ev-repair', 'made-up'];
    const input = { caseId: caseData.id, argument: caseData.cards[0].text, evidenceIds: foreignIds, gameResult: 'opponent_win' };
    const { body: debate } = await postCampaign(baseUrl, 'respond', input);
    assert.deepEqual(debate.data.turn.evidenceIds, []);
    assert.ok(debate.data.scoreChange < 0);
    const verdict = { data: buildVerdict(input) };
    assert.equal(verdict.data.status, 'opponent_win');
    assert.equal(verdict.data.score, 0);
    assert.equal(verdict.data.gameResult, 'opponent_win');
    const oneKey = caseData.keyEvidenceIds.slice(0, 1);
    const { body: single } = await postCampaign(baseUrl, 'respond', { ...input, evidenceIds: oneKey });
    const { body: duplicates } = await postCampaign(baseUrl, 'respond', { ...input, evidenceIds: [...oneKey, ...oneKey, ...foreignIds] });
    assert.equal(single.data.scoreChange, duplicates.data.scoreChange);
    assert.deepEqual(duplicates.data.turn.evidenceIds, oneKey);
  });
});

test('internal verdict formatting follows the validated battle outcome, not evidence completeness', async () => {
  await withServer(async (baseUrl) => {
    const { data: caseData } = await responseJson<ApiData<PublicCampaignCase>>(await fetch(`${baseUrl}/api/campaign/cases/1`));
    const completeEvidence = caseData.keyEvidenceIds;
    const missingEvidence = completeEvidence.slice(0, 1);

    assert.throws(() => buildVerdict({ caseId: caseData.id, evidenceIds: completeEvidence }), { statusCode: 400 });

    const playerWon = { body: { data: buildVerdict({ caseId: caseData.id, evidenceIds: missingEvidence, gameResult: 'player_win' }) } };
    const opponentWon = { body: { data: buildVerdict({ caseId: caseData.id, evidenceIds: completeEvidence, gameResult: 'opponent_win' }) } };
    assert.equal(playerWon.body.data.gameResult, 'player_win');
    assert.equal(playerWon.body.data.status, 'player_win');
    assert.equal(playerWon.body.data.winner.includes(caseData.playerSide), true);
    assert.equal(opponentWon.body.data.gameResult, 'opponent_win');
    assert.equal(opponentWon.body.data.status, 'opponent_win');
    assert.equal(opponentWon.body.data.winner.includes(caseData.opponentSide), true);
    assert.equal(opponentWon.body.data.chain.length, completeEvidence.length);
  });
});

test('POST /api/community/posts requires explicit share content', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/community/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '缺少正文' }),
    });
    const body = await responseJson<ApiError>(response);

    assert.equal(response.status, 400);
    assert.match(body.error.message, /title 和 body/);
  });
});
