type BangumiData = {
  items?: Array<{
    begin?: string;
    broadcast?: string;
    sites?: Array<{ site?: string; id?: string }>;
  }>;
};

export type BroadcastSchedule = {
  airDate: string;
  airTime: string;
};

const BANGUMI_DATA_URL = 'https://unpkg.com/bangumi-data@0.3/dist/data.json';
const BANGUMI_INDEX_URL = 'https://bgm.tv/index/99544';

export async function fetchBroadcastTimes(fetchImpl: typeof fetch, userAgent: string): Promise<Map<number, BroadcastSchedule>> {
  const [dataTimes, indexTimes] = await Promise.all([fetchBangumiDataTimes(fetchImpl, userAgent), fetchBangumiIndexTimes(fetchImpl, userAgent)]);
  return new Map([...dataTimes, ...indexTimes]);
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

function mapBroadcastTimes(data: BangumiData): Map<number, BroadcastSchedule> {
  const times = new Map<number, BroadcastSchedule>();
  for (const item of data.items ?? []) {
    const airTime = extractShanghaiTime(item.broadcast || item.begin || '');
    if (!airTime) continue;
    for (const site of item.sites ?? []) {
      if (site.site !== 'bangumi') continue;
      const subjectId = Number(site.id);
      if (Number.isInteger(subjectId)) {
        times.set(subjectId, { airDate: '', airTime });
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
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + (hour >= 24 ? 1 : 0)));
  const shanghaiHour = (hour + 23) % 24;
  return {
    airDate: date.toISOString().slice(0, 10),
    airTime: `${String(shanghaiHour).padStart(2, '0')}:${match[5]}`
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
