import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchBroadcastCatalog,
  fetchBroadcastTimes,
  parseAcgSecretsSeason
} from '../../src/server/broadcast-schedule.js';
import { buildSeasonWindow } from '../../src/server/season-window.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('broadcast schedule', () => {
  it('parses normalized new, continuing, and next-day season entries', () => {
    const html = `
      <div class="CV-search acgs-card anime-type-new" acgs-bangumi-data-id="anime-1"
        onairtime="1783180800000" weektoday="六" weektomorrow="日" datetoday="7月4日" weekairtime="52330"></div>
      <div class="CV-search acgs-card anime-type-continue" acgs-bangumi-data-id="anime-2"
        onairtime="1784298600000" weektoday="五" weektomorrow="五" datetoday="7月17日" weekairtime="52330"></div>
      <div class="CV-search acgs-card anime-type-new" acgs-bangumi-data-id="anime-without-bangumi"
        onairtime="1783180800000" weektoday="六"></div>
      <div acgs-bangumi-anime-id="anime-1"><a href="https://bangumi.tv/subject/101">Bangumi</a></div>
      <div acgs-bangumi-anime-id="anime-2"><a href="https://bangumi.tv/subject/202">Bangumi</a></div>
      <div acgs-bangumi-anime-id="anime-without-bangumi"><a href="https://example.com/303">Other</a></div>
    `;

    const catalog = parseAcgSecretsSeason(html, '2026Q3');

    expect(catalog.entries.get(101)).toEqual({
      subjectId: 101,
      seasonKey: '2026Q3',
      seasonKind: 'new',
      normalPremiereDate: '2026-07-05',
      airTime: '00:00',
      dayOffset: 1
    });
    expect(catalog.entries.get(202)).toEqual({
      subjectId: 202,
      seasonKey: '2026Q3',
      seasonKind: 'continuing',
      normalPremiereDate: '2026-07-17',
      airTime: '22:30',
      dayOffset: 0
    });
    expect(catalog.entries.has(303)).toBe(false);
  });

  it('keeps cross-quarter continuations out of the current-quarter anchor', () => {
    const current = parseAcgSecretsSeason(`
      <div class="CV-search acgs-card anime-type-new acgs-anime-continue" acgs-bangumi-data-id="historical"
        onairtime="1751644800000" weektoday="六" datetoday="跨季續播"></div>
      <div class="CV-search acgs-card anime-type-new" acgs-bangumi-data-id="new"
        onairtime="1783180800000" weektoday="六" datetoday="7月4日"></div>
      <div class="CV-search acgs-card anime-type-continue" acgs-bangumi-data-id="continuing"
        onairtime="1784298600000" weektoday="五" datetoday="7月17日"></div>
      <div acgs-bangumi-anime-id="historical"><a href="https://bangumi.tv/subject/101">Bangumi</a></div>
      <div acgs-bangumi-anime-id="new"><a href="https://bangumi.tv/subject/202">Bangumi</a></div>
      <div acgs-bangumi-anime-id="continuing"><a href="https://bangumi.tv/subject/303">Bangumi</a></div>
    `, '2026Q3');

    expect(current.entries.get(101)?.seasonKind).toBe('continuing');
    expect(current.entries.get(303)?.seasonKind).toBe('continuing');
    expect([...current.entries.keys()]).toEqual([101, 202, 303]);
    expect(buildSeasonWindow('2026-07-01', current, {
      seasonKey: '2026Q2',
      entries: new Map()
    }).anchorDate).toBe('2026-07-05');
  });

  it('fetches only current and previous ACG quarters for the broadcast catalog', async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      urls.push(url);
      if (url === 'https://acgsecrets.hk/bangumi/202607/') {
        return {
          ok: true,
          text: async () => `
            <div class="CV-search acgs-card anime-type-new" acgs-bangumi-data-id="current"
              onairtime="1783180800000" weektoday="六"></div>
            <div acgs-bangumi-anime-id="current"><a href="https://bangumi.tv/subject/101">Bangumi</a></div>
          `
        };
      }
      if (url === 'https://acgsecrets.hk/bangumi/202604/') {
        return {
          ok: true,
          text: async () => `
            <div class="CV-search acgs-card anime-type-new" acgs-bangumi-data-id="previous"
              onairtime="1775404800000" weektoday="日"></div>
            <div acgs-bangumi-anime-id="previous"><a href="https://bangumi.tv/subject/303">Bangumi</a></div>
          `
        };
      }
      if (url === 'https://bgm.tv/index/99544') {
        return {
          ok: true,
          text: async () => '<li id="item_101"><div class="text">2026年7月4日星期六25:30</div></li>'
        };
      }
      return {
        ok: true,
        json: async () => ({ items: [] })
      };
    });

    const catalog = await fetchBroadcastCatalog(
      fetch as typeof globalThis.fetch,
      'tester/bangumi-watch-planner',
      new Date('2026-07-01T00:30:00+08:00')
    );

    expect(urls.filter((url) => url.startsWith('https://acgsecrets.hk/'))).toEqual([
      'https://acgsecrets.hk/bangumi/202607/',
      'https://acgsecrets.hk/bangumi/202604/'
    ]);
    expect(catalog.schedules.get(101)).toEqual({ airDate: '2026-07-05', airTime: '00:00', dayOffset: 1 });
    expect([...catalog.seasonWindow.activeSubjectIds]).toEqual([101, 303]);
  });

  it('marks a partial ACG fetch as non-authoritative even when the other quarter has entries', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === 'https://acgsecrets.hk/bangumi/202607/') return { ok: false };
      if (url === 'https://acgsecrets.hk/bangumi/202604/') {
        return {
          ok: true,
          text: async () => `
            <div class="CV-search acgs-card anime-type-new" acgs-bangumi-data-id="previous"
              onairtime="1775404800000" weektoday="日"></div>
            <div acgs-bangumi-anime-id="previous"><a href="https://bangumi.tv/subject/303">Bangumi</a></div>
          `
        };
      }
      if (url === 'https://bgm.tv/index/99544') return { ok: false };
      return { ok: true, json: async () => ({ items: [] }) };
    });

    const catalog = await fetchBroadcastCatalog(
      fetch as typeof globalThis.fetch,
      'tester/bangumi-watch-planner',
      new Date('2026-07-10T12:00:00+08:00')
    );

    expect(catalog.seasonWindow.entries.has(303)).toBe(true);
    expect(catalog.seasonWindow.authoritative).toBe(false);
  });

  it('prefers ACG Secrets Shanghai schedules and falls back to Bangumi sources', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00+08:00'));
    const fetch = vi.fn(async (url: string) => {
      if (url === 'https://acgsecrets.hk/bangumi/202607/') {
        return {
          ok: true,
          text: async () => `
            <div class="CV-search acgs-card anime-type-new" acgs-bangumi-data-id="anime-2253" onairtime="1783789200000" weektoday="六"></div>
            <div class="CV-search acgs-card anime-type-new" acgs-bangumi-data-id="anime-2274" onairtime="1783173600000" weektoday="六"></div>
            <div class="anime-data" acgs-bangumi-anime-id="anime-2253"><a href="https://bangumi.tv/subject/587109">Bangumi</a></div>
            <div class="anime-data" acgs-bangumi-anime-id="anime-2274"><a href="https://bangumi.tv/subject/552533">Bangumi</a></div>
          `
        };
      }
      if (url === 'https://acgsecrets.hk/bangumi/202604/') {
        return { ok: true, text: async () => '' };
      }
      if (url === 'https://bgm.tv/index/99544') {
        return {
          ok: true,
          text: async () => `
            <li id="item_255209"><div class="text">2026年7月5日星期日23:00</div></li>
            <li id="item_495291"><div class="text">2026年7月5日星期日24:30</div></li>
            <li id="item_501963"><div class="text">2026年7月4日星期六20:00、20:30 1、2话连续放送<br />2026年7月12日星期日24:00 第3话以后</div></li>
            <li id="item_538760"><div class="text">2026年7月4日星期六21:00<br />2026年6月27日星期六21:30先行配信</div></li>
            <li id="item_587109"><div class="text">2026年7月11日星期六26:00</div></li>
            <li id="item_602733"><div class="text">2026年7月4日星期六26:38</div></li>
            <li id="item_552533"><div class="text">2026年7月4日星期六23:30</div></li>
          `
        };
      }
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              begin: '2026-07-01T01:00:00.000Z',
              sites: [{ site: 'bangumi', id: '123' }]
            },
            {
              begin: '2026-07-05T01:00:00.000Z',
              sites: [{ site: 'bangumi', id: '255209' }]
            }
          ]
        })
      };
    });

    const times = await fetchBroadcastTimes(fetch as typeof globalThis.fetch, 'tester/bangumi-watch-planner');

    expect(times.get(123)).toEqual({ airDate: '', airTime: '09:00', dayOffset: 0 });
    expect(times.get(255209)).toEqual({ airDate: '2026-07-05', airTime: '22:00', dayOffset: 0 });
    expect(times.get(495291)).toEqual({ airDate: '2026-07-06', airTime: '23:30', dayOffset: 1 });
    expect(times.get(501963)).toEqual({ airDate: '2026-07-13', airTime: '23:00', dayOffset: 1 });
    expect(times.get(538760)).toEqual({ airDate: '2026-07-04', airTime: '20:00', dayOffset: 0 });
    expect(times.get(587109)).toEqual({ airDate: '2026-07-12', airTime: '01:00', dayOffset: 1 });
    expect(times.get(602733)).toEqual({ airDate: '2026-07-05', airTime: '01:38', dayOffset: 1 });
    expect(times.get(552533)).toEqual({ airDate: '2026-07-04', airTime: '22:00', dayOffset: 0 });
  });
});
