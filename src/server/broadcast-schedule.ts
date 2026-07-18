import type {
  BroadcastCatalog,
  BroadcastSchedule as BroadcastScheduleContract,
  SeasonCatalog,
  SeasonEntry,
  SeasonKind
} from './types.js';
import {
  acgSecretsUrlForSeason,
  buildSeasonWindow,
  previousSeasonKey,
  seasonKeyForDate
} from './season-window.js';

type BangumiData = {
  items?: Array<{
    begin?: string;
    broadcast?: string;
    sites?: Array<{ site?: string; id?: string }>;
  }>;
};

export type BroadcastSchedule = BroadcastScheduleContract;

const BANGUMI_DATA_URL = 'https://unpkg.com/bangumi-data@0.3/dist/data.json';
const BANGUMI_INDEX_URL = 'https://bgm.tv/index/99544';

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
  const [dataTimes, indexTimes, current, previous] = await Promise.all([
    fetchBangumiDataTimes(fetchImpl, userAgent),
    fetchBangumiIndexTimes(fetchImpl, userAgent),
    fetchAcgSecretsSeason(fetchImpl, userAgent, currentSeasonKey),
    fetchAcgSecretsSeason(fetchImpl, userAgent, priorSeasonKey)
  ]);
  const schedules = new Map([
    ...dataTimes,
    ...indexTimes,
    ...seasonSchedules(previous),
    ...seasonSchedules(current)
  ]);
  return {
    schedules,
    seasonWindow: buildSeasonWindow(shanghaiDate(now), current, previous)
  };
}

export function shiftAirDate(airDate: string, days: number): string {
  if (!days || !/^\d{4}-\d{2}-\d{2}$/.test(airDate)) return airDate;
  const date = new Date(`${airDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== airDate) return airDate;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function fetchBangumiDataTimes(fetchImpl: typeof fetch, userAgent: string): Promise<Map<number, BroadcastSchedule>> {
  try {
    const response = await fetchImpl(BANGUMI_DATA_URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent
      }
    });
    if (!response.ok) {
      return new Map();
    }
    return mapBroadcastTimes((await response.json()) as BangumiData);
  } catch {
    return new Map();
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

async function fetchAcgSecretsSeason(fetchImpl: typeof fetch, userAgent: string, seasonKey: string): Promise<SeasonCatalog> {
  try {
    const response = await fetchImpl(acgSecretsUrlForSeason(seasonKey), {
      headers: {
        Accept: 'text/html',
        'User-Agent': userAgent
      }
    });
    if (!response.ok) return { seasonKey, entries: new Map(), available: false };
    return parseAcgSecretsSeason(await response.text(), seasonKey);
  } catch {
    return { seasonKey, entries: new Map(), available: false };
  }
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
        times.set(subjectId, { airDate: '', airTime, dayOffset: 0 });
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

export function parseAcgSecretsSeason(html: string, seasonKey: string): SeasonCatalog {
  const cards = new Map<string, { timestamp: number; weekday: string; seasonKind: SeasonKind }>();
  for (const match of html.matchAll(/<div\b[^>]*class="([^"]*\bacgs-card\b[^"]*)"[^>]*>/g)) {
    const tag = match[0];
    const classes = match[1];
    const animeId = tag.match(/acgs-bangumi-data-id="([^"]+)"/)?.[1];
    const timestamp = Number(tag.match(/onairtime="(\d+)"/)?.[1]);
    const weekday = tag.match(/weektoday="([^"]+)"/)?.[1];
    const seasonKind = classes.includes('anime-type-continue')
      || classes.includes('acgs-anime-continue')
      || tag.includes('datetoday="跨季續播"')
      ? 'continuing'
      : classes.includes('anime-type-new') ? 'new' : null;
    if (animeId && Number.isFinite(timestamp) && weekday && seasonKind) {
      cards.set(animeId, { timestamp, weekday, seasonKind });
    }
  }

  const entries = new Map<number, SeasonEntry>();
  const details = [...html.matchAll(/<div\b[^>]*acgs-bangumi-anime-id="([^"]+)"[^>]*>/g)];
  for (let index = 0; index < details.length; index += 1) {
    const card = cards.get(details[index][1]);
    if (!card) continue;
    const block = html.slice(details[index].index, details[index + 1]?.index ?? html.length);
    const subjectId = Number(block.match(/https:\/\/bangumi\.tv\/subject\/(\d+)/)?.[1]);
    if (!Number.isInteger(subjectId) || subjectId <= 0) continue;

    const date = new Date(card.timestamp);
    if (Number.isNaN(date.getTime())) continue;
    const normalPremiereDate = shanghaiDate(date);
    const airTime = extractShanghaiTime(date.toISOString());
    const sourceWeekday = '一二三四五六日'.indexOf(card.weekday) + 1;
    const actualWeekday = new Date(`${normalPremiereDate}T00:00:00+08:00`).getDay() || 7;
    const dayOffset = (actualWeekday - sourceWeekday + 7) % 7 === 1 ? 1 : 0;
    entries.set(subjectId, {
      subjectId,
      seasonKey,
      seasonKind: card.seasonKind,
      normalPremiereDate,
      airTime,
      dayOffset
    });
  }
  return { seasonKey, entries, available: true };
}

function seasonSchedules(catalog: SeasonCatalog): Map<number, BroadcastSchedule> {
  return new Map([...catalog.entries].map(([subjectId, entry]) => [subjectId, {
    airDate: entry.normalPremiereDate,
    airTime: entry.airTime,
    dayOffset: entry.dayOffset
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
    dayOffset
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
