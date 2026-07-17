import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBroadcastTimes } from '../../src/server/broadcast-schedule.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('broadcast schedule', () => {
  it('prefers ACG Secrets Shanghai schedules and falls back to Bangumi sources', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00+08:00'));
    const fetch = vi.fn(async (url: string) => {
      if (url === 'https://acgsecrets.hk/bangumi/202607/') {
        return {
          ok: true,
          text: async () => `
            <div class="CV-search acgs-card" acgs-bangumi-data-id="anime-2253" onairtime="1783789200000" weektoday="六"></div>
            <div class="CV-search acgs-card" acgs-bangumi-data-id="anime-2274" onairtime="1783173600000" weektoday="六"></div>
            <div class="anime-data" acgs-bangumi-anime-id="anime-2253"><a href="https://bangumi.tv/subject/587109">Bangumi</a></div>
            <div class="anime-data" acgs-bangumi-anime-id="anime-2274"><a href="https://bangumi.tv/subject/552533">Bangumi</a></div>
          `
        };
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
