const ZHIHU_HACKATHON_API_BASE = 'https://api.zhihu.com/km-indep-home/hackathon/v2';
const DEFAULT_TIMEOUT_MS = 8000;

function apiError(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLabels(value) {
  return Array.isArray(value) ? value.map(asText).filter(Boolean).slice(0, 12) : [];
}

function validateWorkId(value) {
  const workId = asText(value);
  if (!/^\d{6,32}$/.test(workId)) throw apiError('无效的知乎故事编号', 400);
  return workId;
}

function normalizeStorySummary(item) {
  if (!item || typeof item !== 'object') return null;
  const workId = asText(item.work_id);
  const title = asText(item.title);
  if (!/^\d{6,32}$/.test(workId) || !title) return null;
  return {
    ...item,
    work_id: workId,
    title,
    artwork: asText(item.artwork),
    tab_artwork: asText(item.tab_artwork),
    description: asText(item.description),
    labels: asLabels(item.labels),
  };
}

function normalizeStoryDetail(item, expectedWorkId) {
  if (!item || typeof item !== 'object') throw apiError('知乎故事详情格式异常');
  const workId = asText(item.work_id);
  if (workId !== expectedWorkId) throw apiError('知乎故事详情与请求编号不一致');
  const title = asText(item.chapter_name);
  const content = asText(item.content);
  if (!title || !content) throw apiError('知乎故事详情缺少标题或正文');
  return {
    ...item,
    work_id: workId,
    chapter_name: title,
    author_avatar: asText(item.author_avatar),
    author_name: asText(item.author_name),
    labels: asLabels(item.labels),
    introduction: asText(item.introduction),
    content,
    content_length: content.length,
  };
}

function createZhihuContentClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 运行时不支持 fetch');

  async function request(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${ZHIHU_HACKATHON_API_BASE}${path}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw apiError(`知乎内容接口请求失败：${response.status}`);
      try {
        return await response.json();
      } catch {
        throw apiError('知乎内容接口返回了无效 JSON');
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw apiError('知乎内容接口请求超时', 504);
      if (error?.statusCode) throw error;
      throw apiError('暂时无法连接知乎内容接口');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async listStories() {
      const payload = await request('/story/list');
      if (!Array.isArray(payload)) throw apiError('知乎故事列表格式异常');
      return payload.map(normalizeStorySummary).filter(Boolean);
    },
    async getStory(value) {
      const workId = validateWorkId(value);
      return normalizeStoryDetail(await request(`/story/${encodeURIComponent(workId)}`), workId);
    },
  };
}

module.exports = {
  ZHIHU_HACKATHON_API_BASE,
  createZhihuContentClient,
  normalizeStoryDetail,
  normalizeStorySummary,
  validateWorkId,
};
