import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type {
  BacklogTaskRow,
  BangumiCollectionType,
  DashboardSubject,
  EpisodeRow,
  PlannerMode,
  SubjectRow,
  SyncRepository,
  WishlistData
} from './types.js';

export type Repository = SyncRepository & {
  getSetting(key: string): Promise<string | null>;
  listEpisodes(): Promise<EpisodeRow[]>;
  listSubjects(): Promise<DashboardSubject[]>;
  getSubject(subjectId: number): Promise<SubjectRow | null>;
  listSubjectsByCollection(types: BangumiCollectionType[]): Promise<DashboardSubject[]>;
  listSubjectsByMode(mode: Exclude<PlannerMode, null>, types: BangumiCollectionType[]): Promise<DashboardSubject[]>;
  setSubjectState(subjectId: number, state: Pick<SubjectRow, 'collectionType' | 'plannerMode' | 'completedAt'>): Promise<void>;
  listWishlist(query: string, year: number | null | 'unknown'): Promise<WishlistData>;
  listBacklogTasks(fromDate: string, throughDate: string): Promise<BacklogTaskRow[]>;
  replaceBacklogTasks(input: {
    fromDate: string;
    throughDate: string;
    preserveLocked: boolean;
    tasks: Array<Omit<BacklogTaskRow, 'id' | 'episode'>>;
  }): Promise<void>;
  deleteBacklogTask(episodeId: number): Promise<void>;
  lockBacklogDate(date: string): Promise<void>;
  skipBacklogDate(date: string): Promise<void>;
  clearBacklogDateOverrides(date: string): Promise<void>;
  excludeEpisodeOnDate(date: string, episodeId: number): Promise<void>;
  listSkippedBacklogDates(fromDate: string, throughDate: string): Promise<string[]>;
  listBacklogExclusions(fromDate: string, throughDate: string): Promise<Array<{ plannedDate: string; episodeId: number }>>;
  prunePlannerState(beforeDate: string): Promise<void>;
  getEpisode(episodeId: number): Promise<EpisodeRow | null>;
  markEpisodeWatched(episodeId: number): Promise<void>;
  markEpisodeUnwatched(episodeId: number): Promise<void>;
  dismissEpisode(episodeId: number, dismissedAt: string): Promise<void>;
  getLastNotificationDate(): Promise<string | null>;
  setLastNotificationDate(date: string): Promise<void>;
};

export function createRepository(dbPath: string): Repository {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);

  return {
    async getSetting(key) {
      const row = db.prepare('select value from settings where key = ?').get(key) as { value: string } | undefined;
      return row?.value ?? null;
    },

    async setSetting(key, value) {
      db.prepare(
        'insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value'
      ).run(key, value);
    },

    async upsertSubject(subject) {
      const hasPlannerState = [
        'collectionType', 'plannerMode', 'seasonKey', 'seasonKind', 'airYear', 'totalEpisodesKnown', 'completedAt'
      ].some((key) => Object.hasOwn(subject, key));
      db.prepare(
        `insert into subjects (
           id, name, name_cn, eps, ep_status, image, url, collection_type, planner_mode,
           season_key, season_kind, air_year, total_episodes_known, completed_at, updated_at
         ) values (
           @id, @name, @nameCn, @eps, @epStatus, @image, @url, @collectionType, @plannerMode,
           @seasonKey, @seasonKind, @airYear, @totalEpisodesKnown, @completedAt, datetime('now')
         )
         on conflict(id) do update set
           name = excluded.name,
           name_cn = excluded.name_cn,
           eps = excluded.eps,
           ep_status = excluded.ep_status,
           image = excluded.image,
           url = excluded.url,
           collection_type = case when @hasPlannerState then excluded.collection_type else collection_type end,
           planner_mode = case when @hasPlannerState then excluded.planner_mode else planner_mode end,
           season_key = case when @hasPlannerState then excluded.season_key else season_key end,
           season_kind = case when @hasPlannerState then excluded.season_kind else season_kind end,
           air_year = case when @hasPlannerState then excluded.air_year else air_year end,
           total_episodes_known = case when @hasPlannerState then excluded.total_episodes_known else total_episodes_known end,
           completed_at = case when @hasPlannerState then excluded.completed_at else completed_at end,
           updated_at = datetime('now')`
      ).run({
        ...subject,
        collectionType: subject.collectionType ?? 3,
        plannerMode: hasPlannerState ? subject.plannerMode ?? null : 'seasonal',
        seasonKey: subject.seasonKey ?? null,
        seasonKind: subject.seasonKind ?? null,
        airYear: subject.airYear ?? null,
        totalEpisodesKnown: subject.totalEpisodesKnown ? 1 : 0,
        completedAt: subject.completedAt ?? null,
        hasPlannerState: hasPlannerState ? 1 : 0
      });
    },

    async replaceSubjectEpisodes(subjectId, episodes) {
      const existingDismissals = new Map<number, string | null>(
        (
          db.prepare('select id, dismissed_at as dismissedAt from episodes where subject_id = ?').all(subjectId) as {
            id: number;
            dismissedAt: string | null;
          }[]
        ).map((row) => [row.id, row.dismissedAt])
      );
      const tx = db.transaction((rows: EpisodeRow[]) => {
        db.prepare('delete from episodes where subject_id = ?').run(subjectId);
        const insert = db.prepare(
          `insert into episodes (
            id, subject_id, subject_name, subject_name_cn, subject_url,
            episode_type, sort, ep, name, name_cn, airdate, air_time, collection_type, dismissed_at
          ) values (
            @id, @subjectId, @subjectName, @subjectNameCn, @subjectUrl,
            @episodeType, @sort, @ep, @name, @nameCn, @airdate, @airTime, @collectionType, @dismissedAt
          )`
        );
        for (const row of rows) {
          insert.run({ ...row, airTime: row.airTime ?? '', dismissedAt: existingDismissals.get(row.id) ?? row.dismissedAt });
        }
      });
      tx(episodes);
    },

    async listEpisodes() {
      return selectEpisodes(db, '');
    },

    async listSubjects() {
      return selectDashboardSubjects(db);
    },

    async getSubject(subjectId) {
      return selectSubjects(db, 'where id = ?', [subjectId])[0] ?? null;
    },

    async listSubjectsByCollection(types) {
      if (types.length === 0) return [];
      return selectDashboardSubjects(db, `where collection_type in (${placeholders(types)})`, types);
    },

    async listSubjectsByMode(mode, types) {
      if (types.length === 0) return [];
      return selectDashboardSubjects(db, `where planner_mode = ? and collection_type in (${placeholders(types)})`, [mode, ...types]);
    },

    async setSubjectState(subjectId, state) {
      db.prepare(
        'update subjects set collection_type = ?, planner_mode = ?, completed_at = ?, updated_at = datetime(\'now\') where id = ?'
      ).run(state.collectionType, state.plannerMode, state.completedAt, subjectId);
    },

    async listWishlist(query, year) {
      const where = ['collection_type = 1'];
      const params: unknown[] = [];
      if (query) {
        where.push("coalesce(nullif(name_cn, ''), name) like ? collate nocase");
        params.push(`%${query}%`);
      }
      if (year === 'unknown') {
        where.push('air_year is null');
      } else if (year !== null) {
        where.push('air_year = ?');
        params.push(year);
      }
      const currentSeason = seasonKeyForToday();
      const items = selectSubjects(db, `where ${where.join(' and ')}`, params)
        .map((subject) => ({ ...subject, isCurrentSeason: subject.seasonKey === currentSeason }));
      const years = (db.prepare(
        'select distinct air_year as airYear from subjects where collection_type = 1 and air_year is not null order by air_year desc'
      ).all() as Array<{ airYear: number }>).map((row) => row.airYear);
      return { items, years };
    },

    async listBacklogTasks(fromDate, throughDate) {
      const tasks = db.prepare(
        `select id, episode_id as episodeId, subject_id as subjectId, planned_date as plannedDate, slot, locked
         from backlog_tasks
         where planned_date between ? and ?
         order by planned_date, slot`
      ).all(fromDate, throughDate) as Array<Omit<BacklogTaskRow, 'episode' | 'locked'> & { locked: number }>;
      if (tasks.length === 0) return [];
      const episodes = selectEpisodes(db, `where id in (${placeholders(tasks)})`, tasks.map((task) => task.episodeId));
      const byId = new Map(episodes.map((episode) => [episode.id, episode]));
      return tasks.flatMap((task) => {
        const episode = byId.get(task.episodeId);
        return episode ? [{ ...task, locked: task.locked === 1, episode }] : [];
      });
    },

    async replaceBacklogTasks(input) {
      const replace = db.transaction((value: typeof input) => {
        const lockedClause = value.preserveLocked ? ' and locked = 0' : '';
        db.prepare(`delete from backlog_tasks where planned_date between ? and ?${lockedClause}`).run(value.fromDate, value.throughDate);
        const insert = db.prepare(
          `insert into backlog_tasks (episode_id, subject_id, planned_date, slot, locked, created_at)
           values (@episodeId, @subjectId, @plannedDate, @slot, @locked, datetime('now'))`
        );
        for (const task of value.tasks) {
          insert.run({ ...task, locked: task.locked ? 1 : 0 });
        }
      });
      replace(input);
    },

    async deleteBacklogTask(episodeId) {
      db.prepare('delete from backlog_tasks where episode_id = ?').run(episodeId);
    },

    async lockBacklogDate(date) {
      db.prepare('update backlog_tasks set locked = 1 where planned_date = ?').run(date);
    },

    async skipBacklogDate(date) {
      db.prepare("insert into backlog_skipped_days (planned_date, created_at) values (?, datetime('now')) on conflict(planned_date) do nothing").run(date);
    },

    async clearBacklogDateOverrides(date) {
      const clear = db.transaction((plannedDate: string) => {
        db.prepare('delete from backlog_skipped_days where planned_date = ?').run(plannedDate);
        db.prepare('delete from backlog_exclusions where planned_date = ?').run(plannedDate);
      });
      clear(date);
    },

    async excludeEpisodeOnDate(date, episodeId) {
      db.prepare(
        "insert into backlog_exclusions (planned_date, episode_id, created_at) values (?, ?, datetime('now')) on conflict(planned_date, episode_id) do nothing"
      ).run(date, episodeId);
    },

    async listSkippedBacklogDates(fromDate, throughDate) {
      return (db.prepare(
        'select planned_date as plannedDate from backlog_skipped_days where planned_date between ? and ? order by planned_date'
      ).all(fromDate, throughDate) as Array<{ plannedDate: string }>).map((row) => row.plannedDate);
    },

    async listBacklogExclusions(fromDate, throughDate) {
      return db.prepare(
        `select planned_date as plannedDate, episode_id as episodeId
         from backlog_exclusions
         where planned_date between ? and ?
         order by planned_date, episode_id`
      ).all(fromDate, throughDate) as Array<{ plannedDate: string; episodeId: number }>;
    },

    async prunePlannerState(beforeDate) {
      const prune = db.transaction((date: string) => {
        db.prepare('delete from backlog_tasks where planned_date < ?').run(date);
        db.prepare('delete from backlog_skipped_days where planned_date < ?').run(date);
        db.prepare('delete from backlog_exclusions where planned_date < ?').run(date);
      });
      prune(beforeDate);
    },

    async getEpisode(episodeId) {
      return selectEpisodes(db, 'where id = ?', [episodeId])[0] ?? null;
    },

    async markEpisodeWatched(episodeId) {
      const episode = selectEpisodes(db, 'where id = ?', [episodeId])[0] ?? null;
      const progress = episode ? Number(episode.ep ?? episode.sort) : NaN;
      const markWatched = db.transaction(() => {
        db.prepare('update episodes set collection_type = 2 where id = ?').run(episodeId);
        if (episode && Number.isFinite(progress) && progress > 0) {
          db.prepare('update subjects set ep_status = max(ep_status, ?) where id = ?').run(
            Math.floor(progress),
            episode.subjectId
          );
        }
      });
      markWatched();
    },

    async markEpisodeUnwatched(episodeId) {
      const episode = selectEpisodes(db, 'where id = ?', [episodeId])[0] ?? null;
      const markUnwatched = db.transaction(() => {
        db.prepare('update episodes set collection_type = 0 where id = ?').run(episodeId);
        if (episode) {
          db.prepare('update subjects set ep_status = ? where id = ?').run(
            highestWatchedMainEpisodeProgress(db, episode.subjectId),
            episode.subjectId
          );
        }
      });
      markUnwatched();
    },

    async dismissEpisode(episodeId, dismissedAt) {
      db.prepare('update episodes set dismissed_at = ? where id = ?').run(dismissedAt, episodeId);
    },

    async getLastNotificationDate() {
      return this.getSetting('last_notification_date');
    },

    async setLastNotificationDate(date) {
      await this.setSetting('last_notification_date', date);
    }
  };
}

function migrate(db: Database.Database): void {
  db.exec(`
    create table if not exists settings (
      key text primary key,
      value text not null
    );

    create table if not exists subjects (
      id integer primary key,
      name text not null,
      name_cn text not null,
      eps integer not null,
      ep_status integer not null,
      image text,
      url text not null,
      updated_at text not null
    );

    create table if not exists episodes (
      id integer primary key,
      subject_id integer not null,
      subject_name text not null,
      subject_name_cn text not null,
      subject_url text not null,
      episode_type integer not null,
      sort real not null,
      ep real,
      name text not null,
      name_cn text not null,
      airdate text not null,
      air_time text not null default '',
      collection_type integer not null,
      dismissed_at text,
      foreign key(subject_id) references subjects(id) on delete cascade
    );

    create index if not exists episodes_subject_id_idx on episodes(subject_id);
    create index if not exists episodes_airdate_idx on episodes(airdate);
  `);
  addColumnIfMissing(db, 'episodes', 'air_time', "text not null default ''");
  addColumnIfMissing(db, 'subjects', 'collection_type', 'integer not null default 3');
  addColumnIfMissing(db, 'subjects', 'planner_mode', "text default 'seasonal'");
  addColumnIfMissing(db, 'subjects', 'season_key', 'text');
  addColumnIfMissing(db, 'subjects', 'season_kind', 'text');
  addColumnIfMissing(db, 'subjects', 'air_year', 'integer');
  addColumnIfMissing(db, 'subjects', 'total_episodes_known', 'integer not null default 0');
  addColumnIfMissing(db, 'subjects', 'completed_at', 'text');
  db.exec(`
    create table if not exists backlog_tasks (
      id integer primary key autoincrement,
      episode_id integer not null unique,
      subject_id integer not null,
      planned_date text not null,
      slot integer not null,
      locked integer not null default 0,
      created_at text not null,
      foreign key(episode_id) references episodes(id) on delete cascade,
      foreign key(subject_id) references subjects(id) on delete cascade,
      unique(planned_date, slot)
    );

    create table if not exists backlog_skipped_days (
      planned_date text primary key,
      created_at text not null
    );

    create table if not exists backlog_exclusions (
      planned_date text not null,
      episode_id integer not null,
      created_at text not null,
      primary key(planned_date, episode_id),
      foreign key(episode_id) references episodes(id) on delete cascade
    );
  `);
}

function selectSubjects(db: Database.Database, whereClause = '', params: unknown[] = []): SubjectRow[] {
  const rows = db.prepare(
    `select
       id, name, name_cn as nameCn, eps, ep_status as epStatus, image, url,
       collection_type as collectionType, planner_mode as plannerMode, season_key as seasonKey,
       season_kind as seasonKind, air_year as airYear, total_episodes_known as totalEpisodesKnown,
       completed_at as completedAt
     from subjects
     ${whereClause}
     order by coalesce(nullif(name_cn, ''), name) collate nocase`
  ).all(...params) as Array<Omit<SubjectRow, 'totalEpisodesKnown'> & { totalEpisodesKnown: number }>;
  return rows.map((row) => ({ ...row, totalEpisodesKnown: row.totalEpisodesKnown === 1 }));
}

function selectDashboardSubjects(db: Database.Database, whereClause = '', params: unknown[] = []): DashboardSubject[] {
  const subjects = selectSubjects(db, whereClause, params);
  const mainEpisodes = selectEpisodes(db, 'where episode_type = 0');
  const bySubject = new Map<number, EpisodeRow>();
  const countsBySubject = new Map<number, number>();
  const mainEpisodesBySubject = new Map<number, EpisodeRow[]>();
  const unwatchedEpisodesBySubject = new Map<number, EpisodeRow[]>();
  for (const episode of mainEpisodes) {
    const subjectMainEpisodes = mainEpisodesBySubject.get(episode.subjectId) ?? [];
    subjectMainEpisodes.push(episode);
    mainEpisodesBySubject.set(episode.subjectId, subjectMainEpisodes);
    if (episode.collectionType === 2) continue;

    countsBySubject.set(episode.subjectId, (countsBySubject.get(episode.subjectId) ?? 0) + 1);
    const subjectEpisodes = unwatchedEpisodesBySubject.get(episode.subjectId) ?? [];
    subjectEpisodes.push(episode);
    unwatchedEpisodesBySubject.set(episode.subjectId, subjectEpisodes);
    const current = bySubject.get(episode.subjectId);
    if (!current || compareEpisode(episode, current) < 0) {
      bySubject.set(episode.subjectId, episode);
    }
  }
  return subjects.map((subject) => ({
    ...subject,
    nextEpisode: bySubject.get(subject.id) ?? null,
    mainEpisodes: (mainEpisodesBySubject.get(subject.id) ?? []).sort(compareEpisodeProgress),
    unwatchedMainEpisodeCount: countsBySubject.get(subject.id) ?? 0,
    unwatchedMainEpisodes: (unwatchedEpisodesBySubject.get(subject.id) ?? []).sort(compareEpisodeProgress)
  })).sort(compareSubjectNextEpisode);
}

function placeholders(values: { length: number }): string {
  return Array.from({ length: values.length }, () => '?').join(', ');
}

function seasonKeyForToday(): string {
  const month = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', month: 'numeric' }).format());
  const year = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format();
  return `${year}Q${Math.ceil(month / 3)}`;
}

function selectEpisodes(db: Database.Database, whereClause: string, params: unknown[] = []): EpisodeRow[] {
  return db
    .prepare(
      `select
        id,
        subject_id as subjectId,
        subject_name as subjectName,
        subject_name_cn as subjectNameCn,
        subject_url as subjectUrl,
        episode_type as episodeType,
        sort,
        ep,
        name,
        name_cn as nameCn,
        airdate,
        air_time as airTime,
        collection_type as collectionType,
        dismissed_at as dismissedAt
       from episodes
       ${whereClause}
       order by airdate, case when air_time = '' then 1 else 0 end, air_time, subject_name_cn, subject_name, sort`
    )
    .all(...params) as EpisodeRow[];
}

function compareEpisode(a: EpisodeRow, b: EpisodeRow): number {
  const byAirdate = a.airdate.localeCompare(b.airdate);
  if (byAirdate !== 0) return byAirdate;
  const byAirTime = compareAirTime(a.airTime, b.airTime);
  if (byAirTime !== 0) return byAirTime;
  return a.sort - b.sort;
}

function compareSubjectNextEpisode(a: DashboardSubject, b: DashboardSubject): number {
  if (a.nextEpisode && b.nextEpisode) {
    const byEpisode = compareEpisode(a.nextEpisode, b.nextEpisode);
    if (byEpisode !== 0) return byEpisode;
  } else if (a.nextEpisode) {
    return -1;
  } else if (b.nextEpisode) {
    return 1;
  }
  return displaySubject(a).localeCompare(displaySubject(b), 'zh-Hans-CN');
}

function compareAirTime(a: string, b: string): number {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function displaySubject(subject: SubjectRow): string {
  return subject.nameCn || subject.name;
}

function compareEpisodeProgress(a: EpisodeRow, b: EpisodeRow): number {
  return Number(a.ep ?? a.sort) - Number(b.ep ?? b.sort);
}

function highestWatchedMainEpisodeProgress(db: Database.Database, subjectId: number): number {
  return selectEpisodes(db, 'where subject_id = ? and episode_type = 0 and collection_type = 2', [subjectId]).reduce((highest, episode) => {
    const progress = Number(episode.ep ?? episode.sort);
    if (!Number.isFinite(progress) || progress <= 0) return highest;
    return Math.max(highest, Math.floor(progress));
  }, 0);
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((row) => row.name === column)) {
    db.prepare(`alter table ${table} add column ${column} ${definition}`).run();
  }
}
