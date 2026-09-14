const assert = require('node:assert/strict');
const test = require('node:test');
const { createZhihuContentClient, ZHIHU_HACKATHON_API_BASE } = require('./zhihu-content');

test('Zhihu client normalizes the public story catalog without credentials', async () => {
  let request;
  const client = createZhihuContentClient({
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify([
        { work_id: '2025684191967294692', title: ' 蓝血 ', labels: ['悬疑', '', 7], artwork: ' cover ' },
        { work_id: 'bad', title: 'invalid item' },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const stories = await client.listStories();
  assert.equal(request.url, `${ZHIHU_HACKATHON_API_BASE}/story/list`);
  assert.equal(request.init.headers.Accept, 'application/json');
  assert.deepEqual(stories, [{
    work_id: '2025684191967294692', title: '蓝血', labels: ['悬疑'], artwork: 'cover',
    tab_artwork: '', description: '',
  }]);
});

test('Zhihu client validates IDs and normalizes a story detail response', async () => {
  const client = createZhihuContentClient({
    fetchImpl: async () => new Response(JSON.stringify({
      work_id: '2025684191967294692', chapter_name: ' 蓝血 ', author_name: ' 桃花先生 ',
      introduction: ' 简介 ', labels: ['悬疑'], content: ' 公开故事片段 ',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });

  await assert.rejects(() => client.getStory('../bad'), (error) => error.statusCode === 400);
  const story = await client.getStory('2025684191967294692');
  assert.equal(story.chapter_name, '蓝血');
  assert.equal(story.author_name, '桃花先生');
  assert.equal(story.content, '公开故事片段');
  assert.equal(story.content_length, 6);
});

test('Zhihu client maps upstream and JSON failures to a safe gateway error', async () => {
  const unavailable = createZhihuContentClient({ fetchImpl: async () => new Response('', { status: 503 }) });
  await assert.rejects(() => unavailable.listStories(), (error) => error.statusCode === 502 && /503/.test(error.message));

  const malformed = createZhihuContentClient({
    fetchImpl: async () => new Response('{not-json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  await assert.rejects(() => malformed.listStories(), (error) => error.statusCode === 502 && /无效 JSON/.test(error.message));
});
