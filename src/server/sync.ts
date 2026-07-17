import type {
  BangumiClient,
  BangumiEpisodeCollection,
  BangumiSubjectCollection,
  EpisodeRow,
  SubjectRow,
  SyncRepository,
  SyncResult
} from './types.js';
import type { BroadcastSchedule } from './broadcast-schedule.js';

type SyncDeps = {
  username: string;
  client: BangumiClient;
  repository: SyncRepository;
  pageSize?: number;
};

export async function syncWatchingAnime({ username, client, repository, pageSize = 50 }: SyncDeps): Promise<SyncResult> {
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  let subjectsSynced = 0;
  let episodesSynced = 0;
  const broadcastTimes = (await client.getBroadcastTimes?.()) ?? new Map<number, BroadcastSchedule>();

  while (offset < total) {
    const page = await client.getWatchingAnime(username, pageSize, offset);
    total = page.total;

    for (const collection of page.data) {
      const subject = mapSubject(collection);
      const episodes = await getAllSubjectEpisodes(client, subject, broadcastTimes);

      await repository.upsertSubject({
        ...subject,
        eps: getMainEpisodeTotal(subject, episodes)
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

async function getAllSubjectEpisodes(client: BangumiClient, subject: SubjectRow, broadcastTimes: Map<number, BroadcastSchedule>): Promise<EpisodeRow[]> {
  const limit = 1000;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  const episodes: EpisodeRow[] = [];

  while (offset < total) {
      const page = await client.getSubjectEpisodes(subject.id, limit, offset);
      total = page.total ?? offset + page.data.length;
    episodes.push(...page.data.map((episode) => mapEpisode(subject, episode, broadcastTimes.get(subject.id))));

    if (page.data.length === 0) break;
    offset += limit;
  }

  return episodes;
}

function mapSubject(collection: BangumiSubjectCollection): SubjectRow {
  const subject = collection.subject;
  return {
    id: subject.id ?? collection.subject_id,
    name: subject.name,
    nameCn: subject.name_cn ?? '',
    eps: subject.eps ?? 0,
    epStatus: collection.ep_status,
    image: subject.images?.common ?? subject.images?.medium ?? subject.images?.small ?? null,
    url: `https://bgm.tv/subject/${subject.id ?? collection.subject_id}`
  };
}

function mapEpisode(subject: SubjectRow, collection: BangumiEpisodeCollection, schedule?: BroadcastSchedule): EpisodeRow {
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
    airdate: episode.airdate || '',
    airTime: schedule?.airTime ?? '',
    collectionType: collection.type,
    dismissedAt: null
  };
}

function getMainEpisodeTotal(subject: SubjectRow, episodes: EpisodeRow[]): number {
  const mainEpisodes = episodes.filter((episode) => episode.episodeType === 0);
  const knownMainEpisodeCount = mainEpisodes.length;
  const highestKnownMainEpisode = mainEpisodes.reduce((highest, episode) => {
    const progress = Number(episode.ep ?? episode.sort);
    if (!Number.isFinite(progress) || progress <= 0) return highest;
    return Math.max(highest, Math.ceil(progress));
  }, 0);

  return Math.max(subject.eps, subject.epStatus, knownMainEpisodeCount, highestKnownMainEpisode);
}
