import { describe, expect, it, vi } from 'vitest';
import { createBangumiClient } from '../../src/server/bangumi-client.js';

describe('Bangumi client', () => {
  it('sends the expected watched episode patch request', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 204, text: async () => '' }));
    const client = createBangumiClient({
      fetch,
      getAccessToken: async () => 'token-1',
      userAgent: 'tester/bangumi-watch-planner'
    });

    await client.markEpisodesWatched(123, [10, 11]);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.bgm.tv/v0/users/-/collections/123/episodes',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
          'User-Agent': 'tester/bangumi-watch-planner'
        }),
        body: JSON.stringify({ episode_id: [10, 11], type: 2 })
      })
    );
  });

  it('adds an anime subject to the watching collection', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 204, text: async () => '' }));
    const client = createBangumiClient({
      fetch,
      getAccessToken: async () => 'token-1',
      userAgent: 'tester/bangumi-watch-planner'
    });

    await (client as any).addSubjectToWatching(456);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.bgm.tv/v0/users/-/collections/456',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ type: 3 })
      })
    );
  });

  it('searches only anime subjects', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        total: 1,
        data: [
          {
            id: 789,
            type: 2,
            name: 'Test Anime',
            name_cn: '测试动画',
            eps: 12,
            images: { common: 'cover.jpg' }
          }
        ]
      })
    }));
    const client = createBangumiClient({
      fetch,
      getAccessToken: async () => 'token-1',
      userAgent: 'tester/bangumi-watch-planner'
    });

    const results = await (client as any).searchAnimeSubjects('测试');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.bgm.tv/v0/search/subjects?limit=8&offset=0',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ keyword: '测试', sort: 'match', filter: { type: [2] } })
      })
    );
    expect(results).toEqual([
      {
        id: 789,
        name: 'Test Anime',
        nameCn: '测试动画',
        eps: 12,
        image: 'cover.jpg',
        url: 'https://bgm.tv/subject/789'
      }
    ]);
  });

  it('retries transient network failures before surfacing a Bangumi error', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' });
    const client = createBangumiClient({
      fetch,
      getAccessToken: async () => 'token-1',
      userAgent: 'tester/bangumi-watch-planner',
      retryDelayMs: 0
    } as any);

    await client.markEpisodesWatched(123, [10]);

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
