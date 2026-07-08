import type { EpisodeRow } from './types.js';

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
      if (!isValidDateString(episode.airdate)) return false;
      return episode.airdate <= today;
    })
    .sort((a: EpisodeRow, b: EpisodeRow) => {
      const byDate = a.airdate.localeCompare(b.airdate);
      if (byDate !== 0) return byDate;
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

function displaySubject(episode: EpisodeRow): string {
  return episode.subjectNameCn || episode.subjectName;
}
