import type {
  AnimeSearchSubject,
  BroadcastCatalog,
  BroadcastSchedule as BroadcastScheduleContract,
  SeasonCatalog,
  SeasonEntry,
  UpcomingSeasonCandidate,
  UpcomingSeasonCatalog
} from './types.js';
import {
  buildSeasonWindow,
  nextSeasonKey,
  previousSeasonKey,
  seasonKeyForDate,
  yucWikiUrlForSeason
} from './season-window.js';

type BangumiData = {
  items?: Array<{
    title?: string;
    titleTranslate?: Record<string, string[]>;
    type?: string;
    begin?: string;
    broadcast?: string;
    sites?: Array<{ site?: string; id?: string }>;
  }>;
};

export type BroadcastSchedule = BroadcastScheduleContract;

const BANGUMI_DATA_URL = 'https://unpkg.com/bangumi-data@0.3/dist/data.json';
const BANGUMI_INDEX_URL = 'https://bgm.tv/index/99544';
const YUC_NEW_ANIME_URL = 'http://yuc.wiki/new/';

export async function fetchBroadcastTimes(fetchImpl: typeof fetch, userAgent: string): Promise<Map<number, BroadcastSchedule>> {
  return (await fetchBroadcastCatalog(fetchImpl, userAgent, new Date())).schedules;
}

export async function fetchBroadcastCatalog(
  fetchImpl: typeof fetch,
  userAgent: string,
  now: Date
): Promise<BroadcastCatalog> {
  const currentSeasonKey = seasonKeyForDate(now);
  const priorSeasonKey = previousSeasonKey(currentSeasonKey);
  const upcomingSeasonKey = nextSeasonKey(currentSeasonKey);
  const [data, indexTimes, currentHtml, previousHtml, upcomingHtml] = await Promise.all([
    fetchBangumiData(fetchImpl, userAgent),
    fetchBangumiIndexTimes(fetchImpl, userAgent),
    fetchYucWikiSeasonHtml(fetchImpl, userAgent, currentSeasonKey),
    fetchYucWikiSeasonHtml(fetchImpl, userAgent, priorSeasonKey),
    fetchYucWikiSeasonHtml(fetchImpl, userAgent, upcomingSeasonKey)
  ]);
  const dataTimes = mapBroadcastTimes(data);
  const current = currentHtml === null
    ? unavailableSeason(currentSeasonKey)
    : parseYucWikiSeason(currentHtml, currentSeasonKey, data);
  const previous = previousHtml === null
    ? unavailableSeason(priorSeasonKey)
    : parseYucWikiSeason(previousHtml, priorSeasonKey, data);
  const upcoming = upcomingHtml === null
    ? unavailableSeason(upcomingSeasonKey)
    : parseYucWikiSeason(upcomingHtml, upcomingSeasonKey, data);
  const today = shanghaiDate(now);
  const upcomingWindow = buildSeasonWindow(today, upcoming, current);
  const seasonWindow = upcoming.available !== false && upcomingWindow.anchorDate <= today
    ? upcomingWindow
    : buildSeasonWindow(today, current, previous);
  const schedules = new Map([
    ...dataTimes,
    ...indexTimes,
    ...seasonSchedules(previous),
    ...seasonSchedules(current),
    ...seasonSchedules(upcoming)
  ]);
  return {
    schedules,
    seasonWindow
  };
}

export async function fetchYucUpcomingCatalog(
  fetchImpl: typeof fetch,
  userAgent: string,
  seasonKey: string,
  searchAnimeSubjects?: (keyword: string) => Promise<AnimeSearchSubject[]>
): Promise<UpcomingSeasonCatalog> {
  const [data, html, seasonHtml] = await Promise.all([
    fetchBangumiData(fetchImpl, userAgent),
    fetchYucNewAnimeHtml(fetchImpl, userAgent),
    fetchYucWikiSeasonHtml(fetchImpl, userAgent, seasonKey)
  ]);
  if (html === null) return { seasonKey, entries: new Map(), available: false };
  const catalog = parseYucUpcomingSeason(html, seasonKey, data);
  if (searchAnimeSubjects) {
    const candidates = parseYucUpcomingCandidates(html, seasonKey)
      .filter((candidate) => ![...catalog.entries.values()].some((entry) => entry.nameCn === candidate.nameCn));
    const confirmed = await mapWithConcurrency(candidates, 4, async (candidate) => {
      const results = await searchAnimeSubjects(candidate.nameCn).catch(() => []);
      const match = results.find((result) => searchResultMatchesUpcoming(result, candidate.nameCn, seasonKey));
      return match ? {
        subjectId: match.id,
        name: match.name,
        nameCn: match.nameCn || candidate.nameCn,
        image: candidate.image,
        seasonKey,
        sourceType: candidate.sourceType,
        normalPremiereDate: '',
        airTime: '',
        airWeekday: null
      } satisfies UpcomingSeasonCandidate : null;
    });
    for (const entry of confirmed) {
      if (entry && !catalog.entries.has(entry.subjectId)) catalog.entries.set(entry.subjectId, entry);
    }
  }

  const scheduleEntries = seasonHtml === null
    ? new Map<number, SeasonEntry>()
    : parseYucWikiSeason(seasonHtml, seasonKey, data).entries;
  for (const [subjectId, entry] of catalog.entries) {
    const schedule = scheduleEntries.get(subjectId);
    if (!schedule) continue;
    catalog.entries.set(subjectId, {
      ...entry,
      normalPremiereDate: schedule.normalPremiereDate,
      airTime: schedule.airTime,
      airWeekday: weekdayForDate(schedule.normalPremiereDate)
    });
  }
  return catalog;
}

export function shiftAirDate(airDate: string, days: number): string {
  if (!days || !/^\d{4}-\d{2}-\d{2}$/.test(airDate)) return airDate;
  const date = new Date(`${airDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== airDate) return airDate;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function fetchBangumiData(fetchImpl: typeof fetch, userAgent: string): Promise<BangumiData> {
  try {
    const response = await fetchImpl(BANGUMI_DATA_URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent
      }
    });
    if (!response.ok) {
      return {};
    }
    return (await response.json()) as BangumiData;
  } catch {
    return {};
  }
}

async function fetchBangumiIndexTimes(fetchImpl: typeof fetch, userAgent: string): Promise<Map<number, BroadcastSchedule>> {
  try {
    const response = await fetchImpl(BANGUMI_INDEX_URL, {
      headers: {
        Accept: 'text/html',
        'User-Agent': userAgent
      }
    });
    if (!response.ok) {
      return new Map();
    }
    return mapIndexBroadcastTimes(await response.text());
  } catch {
    return new Map();
  }
}

async function fetchYucWikiSeasonHtml(fetchImpl: typeof fetch, userAgent: string, seasonKey: string): Promise<string | null> {
  try {
    const response = await fetchImpl(yucWikiUrlForSeason(seasonKey), {
      headers: {
        Accept: 'text/html',
        'User-Agent': userAgent
      }
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

async function fetchYucNewAnimeHtml(fetchImpl: typeof fetch, userAgent: string): Promise<string | null> {
  try {
    const response = await fetchImpl(YUC_NEW_ANIME_URL, {
      headers: {
        Accept: 'text/html',
        'User-Agent': userAgent
      }
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

function unavailableSeason(seasonKey: string): SeasonCatalog {
  return { seasonKey, entries: new Map(), available: false };
}

function mapBroadcastTimes(data: BangumiData): Map<number, BroadcastSchedule> {
  const times = new Map<number, BroadcastSchedule>();
  for (const item of data.items ?? []) {
    const airTime = extractShanghaiTime(item.broadcast || item.begin || '');
    if (!airTime) continue;
    for (const site of item.sites ?? []) {
      if (site.site !== 'bangumi') continue;
      const subjectId = Number(site.id);
      if (Number.isInteger(subjectId)) {
        times.set(subjectId, { airDate: '', airTime, dayOffset: 0, source: 'Bangumi Data' });
      }
    }
  }
  return times;
}

function extractShanghaiTime(value: string): string {
  const iso = value.startsWith('R/') ? value.slice(2).split('/')[0] : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function mapIndexBroadcastTimes(html: string): Map<number, BroadcastSchedule> {
  const times = new Map<number, BroadcastSchedule>();
  const itemMatches = html.matchAll(/<li\b[^>]*id="item_(\d+)"[\s\S]*?<\/li>/g);
  for (const match of itemMatches) {
    const subjectId = Number(match[1]);
    const text = htmlToText(match[0]);
    const line = chooseBroadcastLine(text);
    const schedule = extractIndexShanghaiSchedule(line);
    if (Number.isInteger(subjectId) && schedule) {
      times.set(subjectId, schedule);
    }
  }
  return times;
}

type BangumiDataItem = NonNullable<BangumiData['items']>[number];

type YucDetail = {
  broadcastText: string;
  titles: string[];
  name: string;
  nameCn: string;
};

export function parseYucWikiSeason(html: string, seasonKey: string, data: BangumiData): SeasonCatalog {
  const cleanHtml = html.replace(/<!--[\s\S]*?-->/g, '');
  const details = yucDetailsByCover(cleanHtml);
  const titleIndex = bangumiDataTitleIndex(data);
  const entries = new Map<number, SeasonEntry>();
  const dayMarkers = [...cleanHtml.matchAll(/<td\b[^>]*class="[^"]*\bdate2\b[^"]*"[^>]*>([\s\S]*?)<\/td>/gi)];

  for (let markerIndex = 0; markerIndex < dayMarkers.length; markerIndex += 1) {
    const weekdayText = htmlToText(dayMarkers[markerIndex][1]);
    const sourceWeekday = '一二三四五六日'.indexOf(weekdayText.match(/周([一二三四五六日])/)?.[1] ?? '') + 1;
    if (sourceWeekday <= 0) continue;
    const start = (dayMarkers[markerIndex].index ?? 0) + dayMarkers[markerIndex][0].length;
    const end = dayMarkers[markerIndex + 1]?.index ?? cleanHtml.length;
    const section = cleanHtml.slice(start, end);

    for (const block of section.matchAll(/<div\b[^>]*style="[^"]*float\s*:\s*left[^"]*"[^>]*>\s*<div\b[^>]*class="[^"]*\bdiv_date\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi)) {
      const time = extractClassText(block[1], 'imgtext').match(/(\d{1,2}):(\d{2})/);
      const cover = block[1].match(/(?:data-src|src)="([^"]+)"/i)?.[1] ?? '';
      const gridTitle = extractClassText(block[2], 'date_title');
      if (!cover || !gridTitle) continue;

      const detail = details.get(cover);
      const item = findBangumiDataItem([...(detail?.titles ?? []), gridTitle], titleIndex, seasonKey);
      const subjectId = bangumiSubjectId(item);
      if (!item || subjectId === null) continue;

      const converted = time
        ? convertYucTime(Number(time[1]), Number(time[2]))
        : bangumiDataSchedule(item, sourceWeekday);
      if (!converted) continue;
      const normalPremiereDate = yucPremiereDate(
        detail?.broadcastText ?? '',
        item.begin ?? '',
        seasonKey,
        sourceWeekday,
        converted.dayOffset
      );
      entries.set(subjectId, {
        subjectId,
        name: item.title || detail?.name || gridTitle,
        nameCn: detail?.nameCn || item.titleTranslate?.['zh-Hans']?.[0] || gridTitle,
        image: cover,
        seasonKey,
        seasonKind: detail ? 'new' : 'continuing',
        normalPremiereDate,
        airTime: converted.airTime,
        dayOffset: converted.dayOffset,
        scheduleSource: time ? 'Yuc Wiki' : 'Bangumi Data'
      });
    }
  }
  return { seasonKey, entries, available: entries.size > 0 };
}

export function parseYucUpcomingSeason(html: string, seasonKey: string, data: BangumiData): UpcomingSeasonCatalog {
  const titleIndex = bangumiDataTitleIndex(data);
  const entries = new Map<number, UpcomingSeasonCandidate>();
  for (const candidate of parseYucUpcomingCandidates(html, seasonKey)) {
    const item = findBangumiDataItem([candidate.nameCn], titleIndex, seasonKey);
    const subjectId = bangumiSubjectId(item);
    if (!item || subjectId === null || seasonKeyForBegin(item.begin) !== seasonKey) continue;
    entries.set(subjectId, {
      ...candidate,
      subjectId,
      name: item.title || candidate.nameCn,
      normalPremiereDate: '',
      airTime: '',
      airWeekday: null
    });
  }
  return { seasonKey, entries, available: true };
}

function parseYucUpcomingCandidates(
  html: string,
  seasonKey: string
): Array<Omit<UpcomingSeasonCandidate, 'subjectId' | 'normalPremiereDate' | 'airTime' | 'airWeekday'>> {
  const candidates: Array<Omit<UpcomingSeasonCandidate, 'subjectId' | 'normalPremiereDate' | 'airTime' | 'airWeekday'>> = [];
  const seasonLabel = yucSeasonLabel(seasonKey);
  const cards = html.replace(/<!--[\s\S]*?-->/g, '').matchAll(
    /<div\b[^>]*style="[^"]*float\s*:\s*left[^"]*"[^>]*>\s*<div\b[^>]*class="[^"]*\bfuture_div\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*>\s*<table\b[^>]*class="[^"]*\bfuture_table\b[^"]*"[^>]*>([\s\S]*?)<\/table>\s*<\/div>\s*<\/div>/gi
  );

  for (const card of cards) {
    const date = extractClassText(card[1], 'future_date');
    if (date !== seasonLabel) continue;
    const title = extractClassText(card[2], 'future_title');
    const image = card[1].match(/(?:data-src|src)="([^"]+)"/i)?.[1] ?? null;
    const sourceType = extractClassText(card[1], 'future_type');
    if (!title || !image) continue;
    candidates.push({
      name: title,
      nameCn: title,
      image,
      seasonKey,
      sourceType
    });
  }
  return candidates;
}

function yucSeasonLabel(seasonKey: string): string {
  const [, year, quarter] = seasonKey.match(/^(\d{4})Q([1-4])$/) ?? [];
  return `${year}${['冬', '春', '夏', '秋'][Number(quarter) - 1] ?? ''}`;
}

function searchResultMatchesUpcoming(result: AnimeSearchSubject, title: string, seasonKey: string): boolean {
  if (isValidDate(result.airDate)) {
    const start = shiftAirDate(firstDateOfSeason(seasonKey), -14);
    const end = shiftAirDate(firstDateOfSeason(nextSeasonKey(seasonKey)), -1);
    return result.airDate >= start && result.airDate <= end;
  }
  const expected = normalizeTitle(title);
  return [result.name, result.nameCn].some((value) => {
    const actual = normalizeTitle(value);
    return actual === expected || (Math.min(actual.length, expected.length) >= 5 && (actual.includes(expected) || expected.includes(actual)));
  });
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function weekdayForDate(value: string): number | null {
  if (!isValidDate(value)) return null;
  return new Date(`${value}T00:00:00Z`).getUTCDay() || 7;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index]);
    }
  }));
  return results;
}

function yucDetailsByCover(html: string): Map<string, YucDetail> {
  const details = new Map<string, YucDetail>();
  for (const match of html.matchAll(/<div\b[^>]*style="[^"]*float\s*:\s*left[^"]*"[^>]*>\s*<img\b([^>]*)>\s*<\/div>\s*<div\b[^>]*>\s*<table\b[^>]*>([\s\S]*?)<\/table>\s*<\/div>/gi)) {
    const cover = match[1].match(/(?:data-src|src)="([^"]+)"/i)?.[1];
    if (!cover) continue;
    const name = extractClassText(match[2], 'title_jp');
    const nameCn = extractClassText(match[2], 'title_cn');
    const titles = [name, nameCn].filter(Boolean);
    details.set(cover, {
      broadcastText: extractClassText(match[2], 'broadcast_r'),
      titles,
      name,
      nameCn
    });
  }
  return details;
}

function extractClassText(html: string, classPrefix: string): string {
  const match = html.match(new RegExp(`<(?:p|td)\\b[^>]*class="[^"]*\\b${classPrefix}[^"]*"[^>]*>([\\s\\S]*?)<\\/(?:p|td)>`, 'i'));
  return match ? htmlToText(match[1]).replace(/\s+/g, ' ').trim() : '';
}

function bangumiDataTitleIndex(data: BangumiData): Map<string, BangumiDataItem[]> {
  const index = new Map<string, BangumiDataItem[]>();
  for (const item of data.items ?? []) {
    if (bangumiSubjectId(item) === null) continue;
    const titles = [item.title ?? '', ...Object.values(item.titleTranslate ?? {}).flat()];
    for (const title of titles) {
      const normalized = normalizeTitle(title);
      if (!normalized) continue;
      const matches = index.get(normalized) ?? [];
      matches.push(item);
      index.set(normalized, matches);
    }
  }
  return index;
}

function findBangumiDataItem(
  titles: string[],
  titleIndex: Map<string, BangumiDataItem[]>,
  seasonKey: string
): BangumiDataItem | undefined {
  for (const title of titles) {
    const matches = titleIndex.get(normalizeTitle(title));
    if (!matches?.length) continue;
    return matches.find((item) => seasonKeyForBegin(item.begin) === seasonKey) ?? matches[0];
  }
  return undefined;
}

function seasonKeyForBegin(begin?: string): string {
  const date = new Date(begin ?? '');
  return Number.isNaN(date.getTime()) ? '' : seasonKeyForDate(date);
}

function bangumiSubjectId(item?: BangumiDataItem): number | null {
  const subjectId = Number(item?.sites?.find((site) => site.site === 'bangumi')?.id);
  return Number.isInteger(subjectId) && subjectId > 0 ? subjectId : null;
}

function normalizeTitle(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function convertYucTime(hour: number, minute: number): { airTime: string; dayOffset: number } {
  const shanghaiMinutes = hour * 60 + minute - 60;
  const dayOffset = Math.floor(shanghaiMinutes / (24 * 60));
  const normalized = ((shanghaiMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return {
    airTime: `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`,
    dayOffset
  };
}

function bangumiDataSchedule(item: BangumiDataItem, sourceWeekday: number): { airTime: string; dayOffset: number } | null {
  const iso = (item.broadcast?.startsWith('R/') ? item.broadcast.slice(2).split('/')[0] : item.broadcast) || item.begin || '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const actualDate = shanghaiDate(date);
  const actualWeekday = new Date(`${actualDate}T00:00:00Z`).getUTCDay() || 7;
  const offset = (actualWeekday - sourceWeekday + 7) % 7;
  return {
    airTime: extractShanghaiTime(date.toISOString()),
    dayOffset: offset === 6 ? -1 : offset
  };
}

function yucPremiereDate(
  broadcastText: string,
  begin: string,
  seasonKey: string,
  sourceWeekday: number,
  dayOffset: number
): string {
  const explicitDate = extractYucDate(broadcastText, seasonKey);
  const beginDate = new Date(begin);
  const fallback = Number.isNaN(beginDate.getTime())
    ? firstDateOfSeason(seasonKey)
    : shiftAirDate(shanghaiDate(beginDate), -dayOffset);
  const sourceDate = alignDateToWeekday(explicitDate || fallback, sourceWeekday);
  return shiftAirDate(sourceDate, dayOffset);
}

function extractYucDate(value: string, seasonKey: string): string {
  const matches = [...value.matchAll(/(\d{1,2})\/(\d{1,2})/g)];
  const match = matches.find((candidate, index) => {
    const end = matches[index + 1]?.index ?? value.length;
    return !value.slice(candidate.index, end).includes('先行');
  }) ?? matches.at(-1);
  if (!match) return '';
  const [, seasonYear, quarter] = seasonKey.match(/^(\d{4})Q([1-4])$/) ?? [];
  const month = Number(match[1]);
  let year = Number(seasonYear);
  if (quarter === '1' && month >= 10) year -= 1;
  if (quarter === '4' && month <= 2) year += 1;
  const date = `${year}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : '';
}

function alignDateToWeekday(date: string, weekday: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  const currentWeekday = parsed.getUTCDay() || 7;
  return shiftAirDate(date, (weekday - currentWeekday + 7) % 7);
}

function firstDateOfSeason(seasonKey: string): string {
  const [, year, quarter] = seasonKey.match(/^(\d{4})Q([1-4])$/) ?? [];
  return `${year}-${String((Number(quarter) - 1) * 3 + 1).padStart(2, '0')}-01`;
}

function seasonSchedules(catalog: SeasonCatalog): Map<number, BroadcastSchedule> {
  return new Map([...catalog.entries].map(([subjectId, entry]) => [subjectId, {
    airDate: entry.normalPremiereDate,
    airTime: entry.airTime,
    dayOffset: entry.dayOffset,
    source: entry.scheduleSource ?? 'Yuc Wiki'
  }]));
}

function shanghaiDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function chooseBroadcastLine(text: string): string {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  return (
    lines.find((line) => /第\d+话以后/.test(line) && !line.includes('先行')) ??
    lines.find((line) => /\d{4}年\d{1,2}月\d{1,2}日星期.\d{1,2}:\d{2}/.test(line) && !line.includes('先行')) ??
    lines.find((line) => /\d{4}年\d{1,2}月\d{1,2}日星期.\d{1,2}:\d{2}/.test(line)) ??
    ''
  );
}

function extractIndexShanghaiSchedule(line: string): BroadcastSchedule | null {
  const match = line.match(/(\d{4})年(\d{1,2})月(\d{1,2})日星期.(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[4]);
  const dayOffset = hour >= 24 ? 1 : 0;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + dayOffset));
  const shanghaiHour = (hour + 23) % 24;
  return {
    airDate: date.toISOString().slice(0, 10),
    airTime: `${String(shanghaiHour).padStart(2, '0')}:${match[5]}`,
    dayOffset,
    source: 'Bangumi Index'
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
