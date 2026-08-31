import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchBroadcastCatalog,
  fetchBroadcastTimes,
  fetchYucUpcomingCatalog,
  parseYucUpcomingSeason,
  parseYucWikiSeason
} from '../../src/server/broadcast-schedule.js';
import { buildSeasonWindow } from '../../src/server/season-window.js';

afterEach(() => {
  vi.useRealTimers();
});

type YucEntryFixture = {
  weekday: string;
  time?: string;
  title: string;
  cover: string;
  jp?: string;
  premiere?: string;
};

function yucPage(entries: YucEntryFixture[]): string {
  const schedule = entries.map((entry) => `
    <table class="date_"><tr><td class="date2">${entry.weekday}</td></tr></table>
    <div style="float:left"><div class="div_date"><p class="${entry.time ? 'imgtext4' : 'imgtext2'}">${entry.time ? `${entry.time}~` : '完结'}</p>
      <img data-src="${entry.cover}"></div><div><table><tr><td class="date_title_">${entry.title}</td></tr></table></div></div>
  `).join('');
  const details = entries.filter((entry) => entry.jp).map((entry) => `
    <div style="float:left"><img width="180px" data-src="${entry.cover}"></div><div><table>
      <tr><td><p class="title_cn_r">${entry.title}</p><p class="title_jp_r">${entry.jp}</p></td></tr>
      <tr><td><p class="broadcast_r">${entry.premiere ?? ''}</p></td></tr>
    </table></div>
  `).join('');
  return `${schedule}${details}`;
}

function dataItem(id: number, title: string, translatedTitles: string[], begin: string) {
  return {
    title,
    titleTranslate: { 'zh-Hans': translatedTitles },
    begin,
    broadcast: `R/${begin}/P7D`,
    sites: [{ site: 'bangumi', id: String(id) }]
  };
}

function bangumiData(items: ReturnType<typeof dataItem>[]) {
  return { items };
}

describe('broadcast schedule', () => {
  it('maps Yuc titles to Bangumi IDs and converts Japanese 30-hour times to Shanghai', () => {
    const catalog = parseYucWikiSeason(yucPage([
      { weekday: '周六', time: '25:30', title: '花织同学转生后还是想干架', jp: '花織さんは転生しても喧嘩がしたい', cover: 'new.jpg', premiere: '7/11周六深夜' },
      { weekday: '周一', time: '24:00', title: '跨季续播', cover: 'continuing.jpg' },
      { weekday: '周二', time: '22:00', title: '没有 Bangumi ID', cover: 'missing.jpg' }
    ]), '2026Q3', bangumiData([
      dataItem(101, '花織さんは転生しても喧嘩がしたい', ['花织同学转生后还是想干架'], '2026-07-11T17:00:00.000Z'),
      dataItem(202, '跨季續播', ['跨季续播'], '2026-04-06T15:00:00.000Z')
    ]));

    expect(catalog.entries.get(101)).toEqual({
      subjectId: 101,
      name: '花織さんは転生しても喧嘩がしたい',
      nameCn: '花织同学转生后还是想干架',
      image: 'new.jpg',
      seasonKey: '2026Q3',
      seasonKind: 'new',
      normalPremiereDate: '2026-07-12',
      airTime: '00:30',
      dayOffset: 1,
      scheduleSource: 'Yuc Wiki'
    });
    expect(catalog.entries.get(202)).toEqual({
      subjectId: 202,
      name: '跨季續播',
      nameCn: '跨季续播',
      image: 'continuing.jpg',
      seasonKey: '2026Q3',
      seasonKind: 'continuing',
      normalPremiereDate: '2026-04-06',
      airTime: '23:00',
      dayOffset: 0,
      scheduleSource: 'Yuc Wiki'
    });
    expect(catalog.entries.has(303)).toBe(false);
  });

  it('filters the Yuc new-anime station to the requested quarter and keeps only Bangumi matches', () => {
    const html = `
      <div style="float:left"><div class="future_div"><p class="future_type_a">原创</p><p class="future_date">2026秋</p><img data-src="501.jpg"></div><div><table class="future_table"><tr><td class="future_title_">新番一</td></tr></table></div></div>
      <div style="float:left"><div class="future_div"><p class="future_type_b">漫改</p><p class="future_date_">2026秋</p><img data-src="missing.jpg"></div><div><table class="future_table"><tr><td class="future_title__">尚未收录</td></tr></table></div></div>
      <div style="float:left"><div class="future_div"><p class="future_type_c">小说改</p><p class="future_date">2027冬</p><img data-src="future.jpg"></div><div><table class="future_table"><tr><td class="future_title_">更远季度</td></tr></table></div></div>
    `;

    const catalog = parseYucUpcomingSeason(html, '2026Q4', bangumiData([
      dataItem(501, 'Title 501', ['新番一'], '2026-10-03T12:00:00.000Z'),
      dataItem(502, 'Old title', ['尚未收录'], '2018-10-03T12:00:00.000Z'),
      dataItem(503, 'Future', ['更远季度'], '2027-01-03T12:00:00.000Z')
    ]));

    expect(catalog.available).toBe(true);
    expect([...catalog.entries.values()]).toEqual([{
      subjectId: 501,
      name: 'Title 501',
      nameCn: '新番一',
      image: '501.jpg',
      seasonKey: '2026Q4',
      sourceType: '原创',
      normalPremiereDate: '',
      airTime: '',
      airWeekday: null
    }]);
  });

  it('uses the dedicated Yuc station for candidates and the quarterly page for weekly slots', async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      urls.push(url);
      if (url === 'https://unpkg.com/bangumi-data@0.3/dist/data.json') {
        return {
          ok: true,
          json: async () => bangumiData([
            dataItem(501, 'Upcoming One', ['新番一'], '2026-10-06T00:30:00+08:00')
          ])
        };
      }
      if (url === 'http://yuc.wiki/new/') {
        return {
          ok: true,
          text: async () => '<div style="float:left"><div class="future_div"><p class="future_type_a">原创</p><p class="future_date">2026秋</p><img data-src="501.jpg"></div><div><table class="future_table"><tr><td class="future_title_">新番一</td></tr></table></div></div>'
        };
      }
      if (url === 'http://yuc.wiki/202610/') {
        return {
          ok: true,
          text: async () => yucPage([
            { weekday: '周一', time: '25:30', title: '新番一', jp: 'Upcoming One', cover: '501.jpg', premiere: '10/5周一深夜' }
          ])
        };
      }
      return { ok: false };
    });

    const catalog = await fetchYucUpcomingCatalog(fetch as typeof globalThis.fetch, 'tester/bangumi-watch-planner', '2026Q4');

    expect(urls).toContain('http://yuc.wiki/new/');
    expect(urls).toContain('http://yuc.wiki/202610/');
    expect(catalog.entries.get(501)).toMatchObject({
      normalPremiereDate: '2026-10-06',
      airTime: '00:30',
      airWeekday: 2
    });
  });

  it('uses the normal weekly slot instead of an early first broadcast for the season anchor', () => {
    const current = parseYucWikiSeason(yucPage([
      { weekday: '周一', time: '21:00', title: '提前放送', jp: '先行放送', cover: 'early.jpg', premiere: '#1=7/4晚间 #2~周一晚间' },
      { weekday: '周六', time: '21:00', title: '正常放送', jp: '通常放送', cover: 'normal.jpg', premiere: '7/4周六晚间' },
      { weekday: '周五', time: '21:00', title: '跨季续播', cover: 'continuing.jpg' }
    ]), '2026Q3', bangumiData([
      dataItem(101, '先行放送', ['提前放送'], '2026-07-04T12:00:00.000Z'),
      dataItem(202, '通常放送', ['正常放送'], '2026-07-04T12:00:00.000Z'),
      dataItem(303, '跨季續播', ['跨季续播'], '2026-04-03T12:00:00.000Z')
    ]));

    expect(current.entries.get(101)?.normalPremiereDate).toBe('2026-07-06');
    expect(current.entries.get(303)?.seasonKind).toBe('continuing');
    expect([...current.entries.keys()]).toEqual([101, 202, 303]);
    expect(buildSeasonWindow('2026-07-01', current, {
      seasonKey: '2026Q2',
      entries: new Map()
    }).anchorDate).toBe('2026-07-04');
  });

  it('ignores a dated advance release when Yuc also provides the normal premiere date', () => {
    const catalog = parseYucWikiSeason(yucPage([
      { weekday: '周四', time: '22:56', title: '在超市后门吸烟的二人', jp: 'スーパーの裏でヤニ吸うふたり', cover: 'smoking.jpg', premiere: '6/3先行6话 7/9周四深夜' }
    ]), '2026Q3', bangumiData([
      dataItem(571784, 'スーパーの裏でヤニ吸うふたり', ['在超市后门吸烟的二人'], '2026-07-09T14:56:00.000Z')
    ]));

    expect(catalog.entries.get(571784)?.normalPremiereDate).toBe('2026-07-09');
  });

  it('keeps completed Yuc entries and labels their missing time as a Bangumi Data fallback', () => {
    const catalog = parseYucWikiSeason(yucPage([
      { weekday: '周三', title: '历史完结作品', jp: '完結作品', cover: 'completed.jpg', premiere: '4/1周三晚间' }
    ]), '2026Q2', bangumiData([
      dataItem(404, '完結作品', ['历史完结作品'], '2026-04-01T12:30:00.000Z')
    ]));

    expect(catalog.entries.get(404)).toMatchObject({
      airTime: '20:30',
      dayOffset: 0,
      scheduleSource: 'Bangumi Data'
    });
  });

  it('fetches previous, current, and next Yuc quarters for the broadcast catalog', async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      urls.push(url);
      if (url === 'https://unpkg.com/bangumi-data@0.3/dist/data.json') {
        return {
          ok: true,
          json: async () => bangumiData([
            dataItem(101, '今期作品', ['本季作品'], '2026-07-04T16:00:00.000Z'),
            dataItem(303, '前期作品', ['上季作品'], '2026-04-04T12:00:00.000Z')
          ])
        };
      }
      if (url === 'http://yuc.wiki/202607/') {
        return {
          ok: true,
          text: async () => yucPage([
            { weekday: '周六', time: '25:00', title: '本季作品', jp: '今期作品', cover: 'current.jpg', premiere: '7/4周六深夜' }
          ])
        };
      }
      if (url === 'http://yuc.wiki/202604/') {
        return {
          ok: true,
          text: async () => yucPage([
            { weekday: '周六', time: '21:00', title: '上季作品', jp: '前期作品', cover: 'previous.jpg', premiere: '4/4周六晚间' }
          ])
        };
      }
      if (url === 'https://bgm.tv/index/99544') {
        return {
          ok: true,
          text: async () => '<li id="item_101"><div class="text">2026年7月4日星期六25:30</div></li>'
        };
      }
      return { ok: false };
    });

    const catalog = await fetchBroadcastCatalog(
      fetch as typeof globalThis.fetch,
      'tester/bangumi-watch-planner',
      new Date('2026-07-01T00:30:00+08:00')
    );

    expect(urls.filter((url) => url.startsWith('http://yuc.wiki/'))).toEqual([
      'http://yuc.wiki/202607/',
      'http://yuc.wiki/202604/',
      'http://yuc.wiki/202610/'
    ]);
    expect(catalog.schedules.get(101)).toEqual({ airDate: '2026-07-05', airTime: '00:00', dayOffset: 1, source: 'Yuc Wiki' });
    expect([...catalog.seasonWindow.activeSubjectIds]).toEqual([101, 303]);
  });

  it('starts the next quarter from its earliest normal Yuc broadcast before the calendar quarter changes', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === 'https://unpkg.com/bangumi-data@0.3/dist/data.json') {
        return { ok: true, json: async () => bangumiData([
          dataItem(202, '前期作品', ['上季作品'], '2026-04-04T12:00:00.000Z'),
          dataItem(303, '今期作品', ['本季作品'], '2026-07-04T12:00:00.000Z')
        ]) };
      }
      if (url === 'http://yuc.wiki/202604/') return { ok: true, text: async () => yucPage([{ weekday: '周六', time: '21:00', title: '上季作品', jp: '前期作品', cover: 'old.jpg', premiere: '4/4周六晚间' }]) };
      if (url === 'http://yuc.wiki/202607/') return { ok: true, text: async () => yucPage([{ weekday: '周六', time: '21:00', title: '本季作品', jp: '今期作品', cover: 'new.jpg', premiere: '6/27周六晚间' }]) };
      return { ok: false };
    });

    const catalog = await fetchBroadcastCatalog(
      fetch as typeof globalThis.fetch,
      'tester/bangumi-watch-planner',
      new Date('2026-06-27T20:00:00+08:00')
    );

    expect(catalog.seasonWindow.currentSeasonKey).toBe('2026Q3');
    expect(catalog.seasonWindow.previousSeasonKey).toBe('2026Q2');
    expect(catalog.seasonWindow.anchorDate).toBe('2026-06-27');
    expect([...catalog.seasonWindow.activeSubjectIds]).toEqual([303, 202]);
  });

  it('marks a partial Yuc fetch as non-authoritative even when the other quarter has entries', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === 'https://unpkg.com/bangumi-data@0.3/dist/data.json') {
        return { ok: true, json: async () => bangumiData([dataItem(303, '前期作品', ['上季作品'], '2026-04-04T12:00:00.000Z')]) };
      }
      if (url === 'http://yuc.wiki/202607/') return { ok: false };
      if (url === 'http://yuc.wiki/202604/') {
        return {
          ok: true,
          text: async () => yucPage([
            { weekday: '周六', time: '21:00', title: '上季作品', jp: '前期作品', cover: 'previous.jpg', premiere: '4/4周六晚间' }
          ])
        };
      }
      if (url === 'https://bgm.tv/index/99544') return { ok: false };
      return { ok: false };
    });

    const catalog = await fetchBroadcastCatalog(
      fetch as typeof globalThis.fetch,
      'tester/bangumi-watch-planner',
      new Date('2026-07-10T12:00:00+08:00')
    );

    expect(catalog.seasonWindow.entries.has(303)).toBe(true);
    expect(catalog.seasonWindow.authoritative).toBe(false);
  });

  it('prefers Yuc Wiki Shanghai schedules and falls back to Bangumi sources', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00+08:00'));
    const fetch = vi.fn(async (url: string) => {
      if (url === 'http://yuc.wiki/202607/') {
        return {
          ok: true,
          text: async () => yucPage([
            { weekday: '周六', time: '25:30', title: '花织同学转生后还是想干架', jp: '花織さんは転生しても喧嘩がしたい', cover: 'hanaori.jpg', premiere: '7/11周六深夜' },
            { weekday: '周六', time: '24:00', title: '穹庐下的魔女', jp: '天幕のジャードゥーガル', cover: 'witch.jpg', premiere: '7/4周六深夜' }
          ])
        };
      }
      if (url === 'http://yuc.wiki/202604/') {
        return {
          ok: true,
          text: async () => yucPage([
            { weekday: '周六', time: '21:00', title: '上季作品', jp: '前期作品', cover: 'previous.jpg', premiere: '4/4周六晚间' }
          ])
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
        json: async () => bangumiData([
          dataItem(123, '数据来源作品', ['数据来源作品'], '2026-07-01T01:00:00.000Z'),
          dataItem(255209, '二十世紀電氣目録', ['二十世纪电气目录'], '2026-07-05T01:00:00.000Z'),
          dataItem(587109, '花織さんは転生しても喧嘩がしたい', ['花织同学转生后还是想干架'], '2026-07-11T17:00:00.000Z'),
          dataItem(552533, '天幕のジャードゥーガル', ['穹庐下的魔女'], '2026-07-04T15:00:00.000Z'),
          dataItem(999, '前期作品', ['上季作品'], '2026-04-04T12:00:00.000Z')
        ])
      };
    });

    const times = await fetchBroadcastTimes(fetch as typeof globalThis.fetch, 'tester/bangumi-watch-planner');

    expect(times.get(123)).toEqual({ airDate: '', airTime: '09:00', dayOffset: 0, source: 'Bangumi Data' });
    expect(times.get(255209)).toEqual({ airDate: '2026-07-05', airTime: '22:00', dayOffset: 0, source: 'Bangumi Index' });
    expect(times.get(495291)).toEqual({ airDate: '2026-07-06', airTime: '23:30', dayOffset: 1, source: 'Bangumi Index' });
    expect(times.get(501963)).toEqual({ airDate: '2026-07-13', airTime: '23:00', dayOffset: 1, source: 'Bangumi Index' });
    expect(times.get(538760)).toEqual({ airDate: '2026-07-04', airTime: '20:00', dayOffset: 0, source: 'Bangumi Index' });
    expect(times.get(587109)).toEqual({ airDate: '2026-07-12', airTime: '00:30', dayOffset: 1, source: 'Yuc Wiki' });
    expect(times.get(602733)).toEqual({ airDate: '2026-07-05', airTime: '01:38', dayOffset: 1, source: 'Bangumi Index' });
    expect(times.get(552533)).toEqual({ airDate: '2026-07-04', airTime: '23:00', dayOffset: 0, source: 'Yuc Wiki' });
  });
});
