import type { BacklogTaskRow, EpisodeRow } from './types.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayInShanghai(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

export function buildReminderCandidates(episodes: EpisodeRow[], today = todayInShanghai()): EpisodeRow[] {
  return episodes
    .filter((episode) => {
      if (episode.episodeType !== 0) return false;
      if (episode.collectionType === 2) return false;
      if (episode.dismissedAt) return false;
      if (episode.snoozedUntil && isValidDateString(episode.snoozedUntil) && episode.snoozedUntil > today) return false;
      if (!isValidDateString(episode.airdate)) return false;
      return episode.airdate <= today;
    })
    .sort((a: EpisodeRow, b: EpisodeRow) => {
      const byDate = a.airdate.localeCompare(b.airdate);
      if (byDate !== 0) return byDate;
      const byTime = compareAirTime(a.airTime, b.airTime);
      if (byTime !== 0) return byTime;
      const bySubject = displaySubject(a).localeCompare(displaySubject(b), 'zh-Hans-CN');
      if (bySubject !== 0) return bySubject;
      return a.sort - b.sort;
    });
}

export function isValidDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function shouldNotifyToday(lastNotificationDate: string | null, today = todayInShanghai()): boolean {
  return lastNotificationDate !== today;
}

export function createNotificationSummary(episodes: EpisodeRow[]): { title: string; body: string } {
  const subjectNames = new Set(episodes.map(displaySubject));
  const title = `有 ${episodes.length} 集番剧待补`;
  const preview = [...subjectNames].slice(0, 3).join('、');
  const suffix = subjectNames.size > 3 ? ` 等 ${subjectNames.size} 部` : '';
  return {
    title,
    body: preview ? `${preview}${suffix} 已有新集可看` : '打开追番计划查看待补列表'
  };
}

export function createDailyNotificationSummary(
  seasonalEpisodes: EpisodeRow[],
  backlogTasks: BacklogTaskRow[]
): { title: string; body: string } | null {
  const sections: string[] = [];
  if (seasonalEpisodes.length > 0) {
    sections.push(`今日新番待看：${formatEpisodes(seasonalEpisodes)}`);
  }
  if (backlogTasks.length > 0) {
    sections.push(`今日补番计划：${formatEpisodes(backlogTasks.map((task) => task.episode))}`);
  }
  return sections.length === 0 ? null : { title: '今日追番计划', body: sections.join('\n') };
}

function formatEpisodes(episodes: EpisodeRow[]): string {
  const bySubject = new Map<number, EpisodeRow>();
  for (const episode of episodes) {
    if (!bySubject.has(episode.subjectId)) {
      bySubject.set(episode.subjectId, episode);
    }
  }
  const preview = [...bySubject.values()]
    .slice(0, 3)
    .map((episode) => `${displaySubject(episode)} 第 ${episode.ep ?? episode.sort} 集`)
    .join('、');
  const suffix = bySubject.size > 3 ? ` 等 ${bySubject.size} 部` : '';
  return `${preview}${suffix}`;
}

function displaySubject(episode: EpisodeRow): string {
  return episode.subjectNameCn || episode.subjectName;
}

function compareAirTime(a: string, b: string): number {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}
