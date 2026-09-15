import assert from 'node:assert/strict';
import test from 'node:test';
import { auditContract, buildCaseDraft, buildVerdict, createServer } from './server.ts';
import type { ServerOptions } from './server.ts';
import { getCampaignLevels, respondToDebate } from './campaign.ts';
import { responseJson, serverUrl } from './test-helpers.ts';
import type { ApiData, ApiError } from './test-helpers.ts';
import type { BattleStart, PublicCampaignCase } from './types.ts';
import type { ZhihuContentClient } from './zhihu-content.ts';

type StoryFeed = {
  stories: { workId: string; caseId: string; title: string; artwork: string; description: string; labels: string[]; playable: boolean }[];
  source: 'zhihu-live' | 'curated-fallback';
  featuredWorkId: string;
  warning?: string;
};
type PublicStoryCase = PublicCampaignCase & { judgment?: unknown };

async function withServer(run: (baseUrl: string) => Promise<void>, options: ServerOptions = {}) {
  const server = createServer({ corsOrigin: '*', ...options });
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

const fakeStoryContent = [
  '人的血液是蓝色的，接触空气后才会慢慢氧化变红。',
  '同事的试卷，里面都是关于急救的知识。\n而我的，第一题是：人的血液是什么颜色？',
  '这段仅用于确认完整接口正文不会被复制进案卷。',
].join('\n');

const fakeZhihuClient: ZhihuContentClient = {
  async listStories() {
    return [{
      work_id: '2025684191967294692', title: '蓝血', artwork: 'https://example.com/blue-blood.jpg',
      tab_artwork: '', description: '我发现这个世界不对劲，这里的人说，血是蓝的。', labels: ['悬疑', '反转'],
    }, {
      work_id: '1747681485547843585', title: '近视眼勇闯恐怖游戏', artwork: '', tab_artwork: '',
      description: '高度近视玩家进入恐怖游戏。', labels: ['惊悚', '脑洞'],
    }];
  },
  async getStory(workId: unknown) {
    assert.equal(workId, '2025684191967294692');
    return {
      work_id: String(workId), chapter_name: '蓝血', author_name: '桃花先生', author_avatar: '',
      introduction: '我发现这个世界不对劲，这里的人说，血是蓝的。',
      labels: ['悬疑', '反转'], content: fakeStoryContent, content_length: fakeStoryContent.length,
    };
  },
};

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

test('Zhihu story endpoints expose the live catalog and a playable spoiler-free case', async () => {
  await withServer(async (baseUrl) => {
    const feedResponse = await fetch(`${baseUrl}/api/zhihu/stories`);
    const feed = await responseJson<ApiData<StoryFeed>>(feedResponse);
    assert.equal(feedResponse.status, 200);
    assert.equal(feedResponse.headers.get('cache-control'), 'no-store');
    assert.equal(feed.data.source, 'zhihu-live');
    assert.equal(feed.data.stories.length, 2);
    assert.equal(feed.data.stories[0].workId, '2025684191967294692');
    assert.equal(feed.data.stories[0].playable, true);

    const caseResponse = await fetch(`${baseUrl}/api/zhihu/stories/2025684191967294692/case`);
    const body = await responseJson<ApiData<PublicStoryCase>>(caseResponse);
    assert.equal(caseResponse.status, 200);
    assert.equal(caseResponse.headers.get('cache-control'), 'no-store');
    assert.equal(body.data.id, 'zhihu-story-2025684191967294692');
    assert.equal(body.data.levelId, 91);
    assert.ok(body.data.source);
    assert.equal(body.data.source.author, '桃花先生');
    assert.equal(body.data.source.mode, 'zhihu-live');
    assert.equal(body.data.source.verifiedQuoteCount, 2);
    assert.equal(body.data.source.apiUrl, 'https://api.zhihu.com/km-indep-home/hackathon/v2/story/2025684191967294692');
    assert.equal(body.data.source.originalUrl, 'https://www.zhihu.com/market/paid_column/2025901212759783232/section/2025684191967294692');
    assert.notEqual(body.data.source.apiUrl, body.data.source.originalUrl);
    assert.equal(body.data.judgment, undefined);
    assert.ok(body.data.storyEnding);
    assert.equal(body.data.storyEnding.title, '案卷暂时封存');
    assert.equal(body.data.storyEnding.hypotheses.length, 4);
    assert.deepEqual(body.data.storyEnding.hypotheses.map((item) => item.id), [
      'world-shift',
      'perception-memory-shift',
      'controlled-observation',
      'insufficient-evidence',
    ]);
    assert.ok(body.data.storyEnding.hypotheses.every((item) => (
      item.title && item.description && item.support && item.evidenceGap && item.nextStep
    )));
    assert.equal(body.data.storyEnding.questions.length, 3);
    assert.deepEqual(
      body.data.storyEnding.questions.filter((item) => item.recommended).map((item) => item.id),
      ['cross-check'],
    );
    assert.ok(body.data.storyEnding.questions.every((item) => (
      item.title && item.question && item.explanation && item.informationValue && item.risk && item.limitation
    )));
    assert.match(body.data.storyEnding.description, /阶段推演/);
    assert.match(body.data.storyEnding.description, /不代表原作结局/);
    assert.match(body.data.storyEnding.closing, /没有替方诺决定真相/);
    assert.equal(body.data.evidence.length, 6);
    assert.equal(body.data.keyEvidenceIds.length, 3);
    assert.deepEqual(body.data.hypothesisEvidenceIds, [
      'zhihu-story-2025684191967294692-ev-archive',
      'zhihu-story-2025684191967294692-ev-follower',
    ]);
    assert.ok(body.data.documents.some((document) => document.content.includes('原文短引')));
    assert.ok(body.data.documents.every((document) => !document.content.includes(fakeStoryContent)));

    const genericCaseResponse = await fetch(`${baseUrl}/api/campaign/cases/${body.data.id}`);
    assert.equal(genericCaseResponse.status, 200);
    assert.equal(genericCaseResponse.headers.get('cache-control'), 'no-store');

    assert.ok(body.data.hypothesisEvidenceIds);
    const payload = {
      caseId: body.data.id,
      argument: '红血和蓝血的观察互相冲突，定向测试与跟踪形成异常时间线。',
      evidenceIds: [...body.data.keyEvidenceIds, body.data.hypothesisEvidenceIds[0]],
      gameResult: 'player_win',
    };
    const debate = await postCampaign(baseUrl, 'respond', payload);
    assert.equal(debate.response.status, 200);
    assert.equal(debate.body.data.caseId, body.data.id);
    const forgedVerdict = await postCampaign(baseUrl, 'verdict', payload);
    assert.equal(forgedVerdict.response.status, 400, 'client-asserted story wins must not bypass signed replay');
    const verdict = buildVerdict(payload);
    assert.ok(verdict.source);
    assert.equal(verdict.source.workId, '2025684191967294692');
    assert.equal(verdict.source.mode, 'zhihu-live');
    assert.equal(verdict.source.apiUrl, body.data.source.apiUrl);
    assert.equal(verdict.source.originalUrl, body.data.source.originalUrl);
    assert.equal(verdict.sources[0].url, body.data.source.originalUrl);
    assert.match(verdict.disclaimer, /知乎故事公开接口片段/);
  }, { zhihuClient: fakeZhihuClient });
});

test('Zhihu story endpoints expose fallback mode without caching the response', async () => {
  const unavailableZhihuClient = {
    async listStories() { throw new Error('upstream unavailable'); },
    async getStory() { throw new Error('upstream unavailable'); },
  };
  await withServer(async (baseUrl) => {
    const feedResponse = await fetch(`${baseUrl}/api/zhihu/stories`);
    const feed = await responseJson<ApiData<StoryFeed>>(feedResponse);
    assert.equal(feedResponse.status, 200);
    assert.equal(feedResponse.headers.get('cache-control'), 'no-store');
    assert.equal(feed.data.source, 'curated-fallback');

    const caseResponse = await fetch(`${baseUrl}/api/zhihu/stories/2025684191967294692/case`);
    const body = await responseJson<ApiData<PublicStoryCase>>(caseResponse);
    assert.equal(caseResponse.status, 200);
    assert.equal(caseResponse.headers.get('cache-control'), 'no-store');
    assert.equal(body.data.source?.mode, 'curated-fallback');
  }, { zhihuClient: unavailableZhihuClient });
});

test('Zhihu story catalog falls back when a valid upstream list omits the featured story', async () => {
  const incompleteZhihuClient = {
    async listStories() { return []; },
    async getStory() { throw new Error('not used'); },
  };
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/zhihu/stories`);
    const body = await responseJson<ApiData<StoryFeed>>(response);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(body.data.source, 'curated-fallback');
    assert.equal(body.data.stories.length, 1);
    assert.equal(body.data.stories[0].workId, '2025684191967294692');
    assert.equal(body.data.stories[0].playable, true);
    assert.match(body.data.warning || '', /暂无《蓝血》/);
  }, { zhihuClient: incompleteZhihuClient });
});

test('a fresh backend instance can debate the featured story before its case endpoint is opened', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/campaign/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: 'zhihu-story-2025684191967294692',
        argument: '红血和蓝血的现场观察互相冲突，说明这里存在客观异常。',
        evidenceIds: [
          'zhihu-story-2025684191967294692-ev-finger',
          'zhihu-story-2025684191967294692-ev-gum',
        ],
      }),
    });
    const body = await responseJson<ApiData<ReturnType<typeof respondToDebate>>>(response);
    assert.equal(response.status, 200);
    assert.equal(body.data.caseId, 'zhihu-story-2025684191967294692');
  }, { zhihuClient: fakeZhihuClient });
});

test('unadapted Zhihu stories stay visible but cannot enter the game', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/zhihu/stories/1747681485547843585/case`);
    const body = await responseJson<ApiError>(response);
    assert.equal(response.status, 404);
    assert.match(body.error.message, /尚未完成互动案卷/);
  }, { zhihuClient: fakeZhihuClient });
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
