import type {
  BangumiClient,
  BangumiEpisodeCollection,
  BangumiSubjectCollection,
  BroadcastCatalog,
  BroadcastSchedule,
  EpisodeRow,
  SeasonWindow,
  SubjectRow,
  SyncRepository,
  SyncResult
} from './types.js';
import type { Repository } from './db.js';
import { buildBacklogPlan, countSeasonalLoad } from './backlog-planner.js';
import { shiftAirDate } from './broadcast-schedule.js';
import { isValidDateString, todayInShanghai } from './reminders.js';

type SyncedSubject = Pick<SubjectRow, 'id' | 'name' | 'nameCn' | 'eps' | 'epStatus' | 'image' | 'url'>;

export async function syncAnimeCollections({
  username,
  client,
  repository,
  today = todayInShanghai(),
  pageSize = 50
}: {
  username: string;
  client: BangumiClient;
  repository: SyncRepository;
  today?: string;
  pageSize?: number;
}): Promise<SyncResult> {
  let subjectsSynced = 0;
  let episodesSynced = 0;
  const broadcastCatalog = await getBroadcastCatalog(client);

  for (const collectionType of [1, 3, 4] as const) {
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;

    while (offset < total) {
      const page = await client.getAnimeCollections(username, collectionType, pageSize, offset);
      total = page.total;

      for (const collection of page.data) {
        const subject = mapSubject(collection);
        const classification = classifySubject(collectionType, subject.id, broadcastCatalog.seasonWindow);

        if (collectionType === 1) {
          await repository.upsertSubject({
            ...subject,
            ...classification,
            airYear: getAirYear(collection.subject.date),
            totalEpisodesKnown: subject.eps > 0,
            completedAt: null
          });
          subjectsSynced += 1;
          continue;
        }

        const episodes = await getAllSubjectEpisodes(client, subject, broadcastCatalog.schedules);
        const apiTotal = collection.subject.eps ?? 0;
        await repository.upsertSubject({
          ...subject,
          ...classification,
          eps: Math.max(apiTotal, collection.ep_status, mainEpisodeCount(episodes), highestMainEpisodeNumber(episodes)),
          airYear: getAirYear(collection.subject.date),
          totalEpisodesKnown: apiTotal > 0,
          completedAt: null
        });
        await repository.replaceSubjectEpisodes(subject.id, episodes);
        subjectsSynced += 1;
        episodesSynced += episodes.length;
      }

      if (page.data.length === 0) break;
      offset += pageSize;
    }
  }

  await rebuildPlan({ repository, today, includeToday: false });
  await repository.setSetting('last_sync_at', new Date().toISOString());
  await repository.setSetting('last_error', '');
  return { subjectsSynced, episodesSynced };
}

export async function syncWatchingAnime({ username, client, repository, pageSize = 50 }: {
  username: string;
  client: BangumiClient;
  repository: Pick<SyncRepository, 'upsertSubject' | 'replaceSubjectEpisodes' | 'setSetting'>;
  pageSize?: number;
}): Promise<SyncResult> {
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  let subjectsSynced = 0;
  let episodesSynced = 0;
  const broadcastTimes = (await client.getBroadcastTimes?.()) ?? new Map();

  while (offset < total) {
    const page = await client.getWatchingAnime(username, pageSize, offset);
    total = page.total;
    for (const collection of page.data) {
      const subject = mapSubject(collection);
      const episodes = await getAllSubjectEpisodes(client, subject, broadcastTimes);
      await repository.upsertSubject({
        ...subject,
        eps: Math.max(subject.eps, subject.epStatus, mainEpisodeCount(episodes), highestMainEpisodeNumber(episodes))
      });
      await repository.replaceSubjectEpisodes(subject.id, episodes);
      subjectsSynced += 1;
      episodesSynced += episodes.length;
    }
    if (page.data.length === 0) break;
    offset += pageSize;
  }

  await repository.setSetting('last_sync_at', new Date().toISOString());
  await repository.setSetting('last_error', '');
  return { subjectsSynced, episodesSynced };
}

export async function rebuildBacklogPlan(input: {
  repository: Repository;
  today: string;
  includeToday: boolean;
}): Promise<void> {
  await rebuildPlan(input);
}

async function rebuildPlan({ repository, today, includeToday }: {
  repository: SyncRepository;
  today: string;
  includeToday: boolean;
}): Promise<void> {
  const tomorrow = addDays(today, 1);
  const throughDate = addDays(today, 6);
  await repository.prunePlannerState(today);
  if (!includeToday) await repository.lockBacklogDate(today);

  const [seasonal, backlog, currentTasks, skipped, exclusions, cursorValue] = await Promise.all([
    repository.listSubjectsByMode('seasonal', [3]),
    repository.listSubjectsByMode('backlog', [3]),
    repository.listBacklogTasks(today, throughDate),
    repository.listSkippedBacklogDates(today, throughDate),
    repository.listBacklogExclusions(today, throughDate),
    repository.getSetting('backlog_rotation_cursor')
  ]);
  const seasonalEpisodes = seasonal.flatMap((subject) => subject.mainEpisodes)
    .filter((episode) => episode.airdate >= today && episode.airdate <= throughDate);
  const seasonalLoadByDate = new Map(dateRange(today, throughDate).map((date) => [date, countSeasonalLoad(seasonalEpisodes, date)]));
  const skippedDates = new Set(skipped);
  if (!includeToday) skippedDates.add(today);
  const exclusionsByDate = new Map<string, Set<number>>();
  for (const exclusion of exclusions) {
    const episodeIds = exclusionsByDate.get(exclusion.plannedDate) ?? new Set<number>();
    episodeIds.add(exclusion.episodeId);
    exclusionsByDate.set(exclusion.plannedDate, episodeIds);
  }

  const plan = buildBacklogPlan({
    today,
    throughDate,
    seasonalLoadByDate,
    subjects: backlog.map((subject) => ({ subjectId: subject.id, episodes: subject.unwatchedMainEpisodes })),
    fixedTasks: currentTasks
      .filter((task) => task.locked)
      .map(({ episodeId, subjectId, plannedDate, slot }) => ({ episodeId, subjectId, plannedDate, slot, locked: true as const })),
    skippedDates,
    exclusions: exclusionsByDate,
    rotationCursorSubjectId: parseCursor(cursorValue)
  });
  const fromDate = includeToday ? today : tomorrow;
  await repository.replaceBacklogTasks({
    fromDate,
    throughDate,
    preserveLocked: true,
    tasks: plan.tasks.filter((task) => task.plannedDate >= fromDate)
  });
  await repository.setSetting('backlog_rotation_cursor', plan.rotationCursorSubjectId === null ? '' : String(plan.rotationCursorSubjectId));
}

async function getBroadcastCatalog(client: BangumiClient): Promise<BroadcastCatalog> {
  if (!client.getBroadcastCatalog) {
    throw new Error('Anime collection sync requires an authoritative season window');
  }
  const catalog = await client.getBroadcastCatalog();
  if (!catalog.seasonWindow.authoritative || catalog.seasonWindow.entries.size === 0) {
    throw new Error('Anime collection sync requires a non-empty authoritative season window');
  }
  return catalog;
}

async function getAllSubjectEpisodes(
  client: BangumiClient,
  subject: SyncedSubject,
  broadcastTimes: BroadcastCatalog['schedules']
): Promise<EpisodeRow[]> {
  const limit = 1000;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  const episodes: EpisodeRow[] = [];
  const schedule = broadcastTimes.get(subject.id);

  while (offset < total) {
    const page = await client.getSubjectEpisodes(subject.id, limit, offset);
    total = page.total ?? offset + page.data.length;
    episodes.push(...page.data.map((episode) => mapEpisode(subject, episode, schedule)));
    if (page.data.length === 0) break;
    offset += limit;
  }

  const firstEpisode = episodes.find((episode) => episode.episodeType === 0 && episode.ep === 1);
  if (schedule?.airDate && firstEpisode && Date.parse(firstEpisode.airdate) - Date.parse(schedule.airDate) === 7 * 24 * 60 * 60 * 1000) {
    return episodes.map((episode) => ({ ...episode, airdate: shiftAirDate(episode.airdate, -7) }));
  }
  return episodes;
}

function classifySubject(
  collectionType: 1 | 3 | 4,
  subjectId: number,
  seasonWindow: SeasonWindow
): Pick<SubjectRow, 'collectionType' | 'plannerMode' | 'seasonKey' | 'seasonKind'> {
  const season = seasonWindow.entries.get(subjectId);
  if (collectionType === 1) {
    return { collectionType, plannerMode: null, seasonKey: season?.seasonKey ?? null, seasonKind: season?.seasonKind ?? null };
  }
  if (collectionType === 4) {
    return { collectionType, plannerMode: 'backlog', seasonKey: season?.seasonKey ?? null, seasonKind: season?.seasonKind ?? null };
  }
  return {
    collectionType,
    plannerMode: seasonWindow.activeSubjectIds.has(subjectId) ? 'seasonal' : 'backlog',
    seasonKey: season?.seasonKey ?? null,
    seasonKind: season?.seasonKind ?? null
  };
}

function mapSubject(collection: BangumiSubjectCollection): SyncedSubject {
  const subject = collection.subject;
  const id = subject.id ?? collection.subject_id;
  return {
    id,
    name: subject.name,
    nameCn: subject.name_cn ?? '',
    eps: subject.eps ?? 0,
    epStatus: collection.ep_status,
    image: subject.images?.common ?? subject.images?.medium ?? subject.images?.small ?? null,
    url: `https://bgm.tv/subject/${id}`
  };
}

function mapEpisode(
  subject: SyncedSubject,
  collection: BangumiEpisodeCollection,
  schedule?: BroadcastSchedule
): EpisodeRow {
  const episode = collection.episode;
  return {
    id: episode.id,
    subjectId: subject.id,
    subjectName: subject.name,
    subjectNameCn: subject.nameCn,
    subjectUrl: subject.url,
    episodeType: episode.type,
    sort: episode.sort,
    ep: episode.ep ?? null,
    name: episode.name,
    nameCn: episode.name_cn ?? '',
    airdate: shiftAirDate(episode.airdate || '', schedule?.dayOffset ?? 0),
    airTime: schedule?.airTime ?? '',
    collectionType: collection.type,
    dismissedAt: null
  };
}

function mainEpisodeCount(episodes: EpisodeRow[]): number {
  return episodes.filter((episode) => episode.episodeType === 0).length;
}

function highestMainEpisodeNumber(episodes: EpisodeRow[]): number {
  return episodes.reduce((highest, episode) => {
    if (episode.episodeType !== 0) return highest;
    const progress = Number(episode.ep ?? episode.sort);
    return Number.isFinite(progress) && progress > 0 ? Math.max(highest, Math.ceil(progress)) : highest;
  }, 0);
}

function getAirYear(date: string | undefined): number | null {
  return date && isValidDateString(date) ? Number(date.slice(0, 4)) : null;
}

function parseCursor(value: string | null): number | null {
  return value && /^[1-9]\d*$/.test(value) ? Number(value) : null;
}

function dateRange(from: string, through: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= through; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
