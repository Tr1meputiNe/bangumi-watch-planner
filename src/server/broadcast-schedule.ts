type BangumiData = {
  items?: Array<{
    begin?: string;
    broadcast?: string;
    sites?: Array<{ site?: string; id?: string }>;
  }>;
};

const BANGUMI_DATA_URL = 'https://unpkg.com/bangumi-data@0.3/dist/data.json';

export async function fetchBroadcastTimes(fetchImpl: typeof fetch, userAgent: string): Promise<Map<number, string>> {
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

function mapBroadcastTimes(data: BangumiData): Map<number, string> {
  const times = new Map<number, string>();
  for (const item of data.items ?? []) {
    const airTime = extractShanghaiTime(item.broadcast || item.begin || '');
    if (!airTime) continue;
    for (const site of item.sites ?? []) {
      if (site.site !== 'bangumi') continue;
      const subjectId = Number(site.id);
      if (Number.isInteger(subjectId)) {
        times.set(subjectId, airTime);
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
