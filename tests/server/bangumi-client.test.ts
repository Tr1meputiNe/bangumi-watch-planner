import { describe, expect, it, vi } from 'vitest';
import { createBangumiClient } from '../../src/server/bangumi-client.js';

describe('Bangumi client', () => {
  it('fetches public calendar data without an access token', async () => {
    const getAccessToken = vi.fn(async () => 'token-1');
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          weekday: { en: 'Thu', cn: '星期四', ja: '木耀日', id: 4 },
          items: [
            {
              id: 456,
              url: 'http://bgm.tv/subject/456',
              type: 2,
              name: 'Calendar Anime',
              name_cn: '测试放送',
              air_date: '2026-07-09',
              air_weekday: 4,
              rating: { score: 7.2, total: 100 },
              rank: 1234,
              images: { common: 'cover.jpg' },
              collection: { doing: 321 }
            }
          ]
        }
      ]
    }));
    const client = createBangumiClient({
      fetch,
      getAccessToken,
      userAgent: 'tester/bangumi-watch-planner'
    });

    await expect(client.getCalendar()).resolves.toEqual([
      {
        weekday: { en: 'Thu', cn: '星期四', ja: '木耀日', id: 4 },
        items: [
          {
            id: 456,
            name: 'Calendar Anime',
            nameCn: '测试放送',
            url: 'https://bgm.tv/subject/456',
            airDate: '2026-07-09',
            airWeekday: 4,
            image: 'cover.jpg',
            ratingScore: 7.2,
            rank: 1234,
            collectionDoing: 321
          }
        ]
      }
    ]);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.bgm.tv/calendar',
      expect.objectContaining({
        headers: expect.not.objectContaining({ Authorization: expect.any(String) })
      })
    );
  });

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

  it('sends the expected unwatched episode patch request', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 204, text: async () => '' }));
    const client = createBangumiClient({
      fetch,
      getAccessToken: async () => 'token-1',
      userAgent: 'tester/bangumi-watch-planner'
    });

    await client.markEpisodesUnwatched(123, [10]);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.bgm.tv/v0/users/-/collections/123/episodes',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
          'User-Agent': 'tester/bangumi-watch-planner'
        }),
        body: JSON.stringify({ episode_id: [10], type: 0 })
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
