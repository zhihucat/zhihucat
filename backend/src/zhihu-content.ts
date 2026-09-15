import { isRecord } from './types.ts';
import type { HttpError, JsonObject } from './types.ts';

export const ZHIHU_HACKATHON_API_BASE = 'https://api.zhihu.com/km-indep-home/hackathon/v2';
const DEFAULT_TIMEOUT_MS = 8000;

export type ZhihuStorySummary = JsonObject & {
  work_id: string;
  title: string;
  artwork: string;
  tab_artwork: string;
  description: string;
  labels: string[];
};

export type ZhihuStoryDetail = JsonObject & {
  work_id: string;
  chapter_name: string;
  author_avatar: string;
  author_name: string;
  labels: string[];
  introduction: string;
  content: string;
  content_length: number;
};

export type ZhihuContentClient = {
  listStories: () => Promise<ZhihuStorySummary[]>;
  getStory: (workId: unknown) => Promise<ZhihuStoryDetail>;
};

type ZhihuClientOptions = {
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
};

function apiError(message: string, statusCode = 502): HttpError {
  return Object.assign(new Error(message), { statusCode });
}

function isHttpError(error: unknown): error is HttpError {
  return error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number';
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asLabels(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asText).filter(Boolean).slice(0, 12) : [];
}

export function validateWorkId(value: unknown): string {
  const workId = asText(value);
  if (!/^\d{6,32}$/.test(workId)) throw apiError('无效的知乎故事编号', 400);
  return workId;
}

export function normalizeStorySummary(item: unknown): ZhihuStorySummary | null {
  if (!isRecord(item)) return null;
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

export function normalizeStoryDetail(item: unknown, expectedWorkId: string): ZhihuStoryDetail {
  if (!isRecord(item)) throw apiError('知乎故事详情格式异常');
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

export function createZhihuContentClient(options: ZhihuClientOptions = {}): ZhihuContentClient {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 运行时不支持 fetch');

  async function request(path: string): Promise<unknown> {
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
      if (error instanceof Error && error.name === 'AbortError') throw apiError('知乎内容接口请求超时', 504);
      if (isHttpError(error)) throw error;
      throw apiError('暂时无法连接知乎内容接口');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async listStories() {
      const payload = await request('/story/list');
      if (!Array.isArray(payload)) throw apiError('知乎故事列表格式异常');
      return payload.map(normalizeStorySummary).filter((item): item is ZhihuStorySummary => Boolean(item));
    },
    async getStory(value: unknown) {
      const workId = validateWorkId(value);
      return normalizeStoryDetail(await request(`/story/${encodeURIComponent(workId)}`), workId);
    },
  };
}
