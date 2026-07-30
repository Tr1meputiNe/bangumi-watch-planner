import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBangumiClient } from '../../src/server/bangumi-client.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('Bangumi client', () => {
  it('returns the concrete broadcast catalog from current and previous ACG pages', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00+08:00'));
    const getAccessToken = vi.fn(async () => 'token-1');
    const fetch = vi.fn(async (url: string) => {
      if (url === 'https://unpkg.com/bangumi-data@0.3/dist/data.json') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (url === 'https://bgm.tv/index/99544') {
        return { ok: true, status: 200, text: async () => '' };
      }
      const current = url === 'https://acgsecrets.hk/bangumi/202607/';
      return {
        ok: true,
        status: 200,
        text: async () => `
          <div class="CV-search acgs-card anime-type-new" acgs-bangumi-data-id="anime"
            onairtime="${Date.parse(current ? '2026-07-04T20:00:00+08:00' : '2026-04-04T20:00:00+08:00')}"
            weektoday="六"></div>
          <div acgs-bangumi-anime-id="anime"><a href="https://bangumi.tv/subject/${current ? 101 : 202}">Bangumi</a></div>
        `
      };
    });
    const client = createBangumiClient({
      fetch,
      getAccessToken,
      userAgent: 'tester/bangumi-watch-planner'
    });

    expect(client.getBroadcastCatalog).toBeTypeOf('function');
    const catalog = await client.getBroadcastCatalog!();

    expect(catalog.seasonWindow).toMatchObject({
      currentSeasonKey: '2026Q3',
      previousSeasonKey: '2026Q2',
      anchorDate: '2026-07-04',
      overlapThrough: '2026-07-17'
    });
    expect([...catalog.seasonWindow.activeSubjectIds]).toEqual([101, 202]);
    expect(catalog.schedules.get(101)).toMatchObject({ airDate: '2026-07-04', airTime: '20:00' });
    expect(catalog.schedules.get(202)).toMatchObject({ airDate: '2026-04-04', airTime: '20:00' });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining([
      'https://acgsecrets.hk/bangumi/202607/',
      'https://acgsecrets.hk/bangumi/202604/'
    ]));
    for (const [, init] of fetch.mock.calls) {
      expect(init).toEqual(expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': 'tester/bangumi-watch-planner' })
      }));
    }
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('fetches public calendar data without an access token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T12:00:00+08:00'));
    const getAccessToken = vi.fn(async () => 'token-1');
    const fetch = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => url === 'https://api.bgm.tv/calendar' ? [
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
      ] : {
        items: [
          {
            begin: '2026-07-09T14:30:00.000Z',
            broadcast: 'R/2026-07-09T14:30:00.000Z/P7D',
            sites: [{ site: 'bangumi', id: '456' }]
          }
        ]
      }
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
            airTime: '22:30',
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

  it('moves 30-hour index broadcasts to their Shanghai calendar day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00+08:00'));
    const fetch = vi.fn(async (url: string) => {
      if (url === 'https://bgm.tv/index/99544') {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <li id="item_501963"><div class="text">2026年7月12日星期日24:00 第3话以后</div></li>
            <li id="item_587109"><div class="text">2026年7月11日星期六26:00</div></li>
            <li id="item_602733"><div class="text">2026年7月4日星期六26:38</div></li>
            <li id="item_552533"><div class="text">2026年7月4日星期六23:30</div></li>
          `
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => url === 'https://api.bgm.tv/calendar' ? [
        {
          weekday: { en: 'Sun', cn: '星期日', ja: '日耀日', id: 7 },
          items: [
            {
              id: 501963,
              url: 'http://bgm.tv/subject/501963',
              type: 2,
              name: 'Mushoku Tensei III',
              name_cn: '无职转生 第三季',
              air_date: '2026-07-12',
              air_weekday: 7,
              images: null
            }
          ]
        },
        {
          weekday: { en: 'Sat', cn: '星期六', ja: '土耀日', id: 6 },
          items: [
            {
              id: 587109,
              url: 'http://bgm.tv/subject/587109',
              type: 2,
              name: 'Kaori',
              name_cn: '花织即使是转生也想打架',
              air_date: '2026-07-18',
              air_weekday: 6,
              images: null
            },
            {
              id: 602733,
              url: 'http://bgm.tv/subject/602733',
              type: 2,
              name: 'Saijo',
              name_cn: '才女的侍从',
              air_date: '2026-07-18',
              air_weekday: 6,
              images: null
            },
            {
              id: 552533,
              url: 'http://bgm.tv/subject/552533',
              type: 2,
              name: 'Jaadugar',
              name_cn: '穹庐下的魔女',
              air_date: '2026-07-04',
              air_weekday: 6,
              images: null
            }
          ]
        },
        {
          weekday: { en: 'Mon', cn: '星期一', ja: '月耀日', id: 1 },
          items: []
        }
      ] : { items: [] }
      };
    });
    const client = createBangumiClient({
      fetch,
      getAccessToken: async () => 'token-1',
      userAgent: 'tester/bangumi-watch-planner'
    });

    const calendar = await client.getCalendar();

    expect(calendar.find((day) => day.weekday.id === 1)?.items).toEqual([
      expect.objectContaining({
        id: 501963,
        airDate: '2026-07-20',
        airTime: '23:00'
      })
    ]);
    expect(calendar.find((day) => day.weekday.id === 7)?.items).toEqual([
      expect.objectContaining({
        id: 587109,
        airDate: '2026-07-19',
        airTime: '01:00'
      }),
      expect.objectContaining({
        id: 602733,
        airDate: '2026-07-19',
        airTime: '01:38'
      })
    ]);
    expect(calendar.find((day) => day.weekday.id === 6)?.items).toEqual([
      expect.objectContaining({
        id: 552533,
        airDate: '2026-07-18'
      })
    ]);
  });

  it.each([1, 3, 4] as const)('loads anime collection type %s with pagination', async (type) => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        total: 1,
        data: [{
          subject_id: 456,
          type,
          ep_status: 0,
          subject: { id: 456, name: 'Test Anime', date: '2026-07-01' }
        }]
      })
    }));
    const client = createBangumiClient({
      fetch,
      getAccessToken: async () => 'token',
      userAgent: 'tester/bangumi-watch-planner'
    });

    const page = await client.getAnimeCollections('sai', type, 50, 100);

    expect(fetch).toHaveBeenCalledWith(
      `https://api.bgm.tv/v0/users/sai/collections?subject_type=2&type=${type}&limit=50&offset=100`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) })
    );
    expect(page.data[0]?.subject.date).toBe('2026-07-01');
  });

  it.each([2, 3, 4] as const)('writes collection type %s with PATCH', async (type) => {
    const fetch = vi.fn(async () => ({ ok: true, status: 204, text: async () => '' }));
    const client = createBangumiClient({
      fetch,
      getAccessToken: async () => 'token',
      userAgent: 'tester/bangumi-watch-planner'
    });

    await client.setSubjectCollectionType(456, type);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.bgm.tv/v0/users/-/collections/456',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ type }) })
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

  it('adds an anime subject to the wishlist collection', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 204, text: async () => '' }));
    const client = createBangumiClient({
      fetch,
      getAccessToken: async () => 'token-1',
      userAgent: 'tester/bangumi-watch-planner'
    });

    await client.addSubjectToWishlist(456);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.bgm.tv/v0/users/-/collections/456',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ type: 1 })
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
            date: '2026-07-01',
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
        airDate: '2026-07-01',
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
