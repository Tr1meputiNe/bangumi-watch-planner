import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { DashboardSubject, EpisodeRow, SubjectRow, SyncRepository } from './types.js';

export type Repository = SyncRepository & {
  getSetting(key: string): Promise<string | null>;
  listEpisodes(): Promise<EpisodeRow[]>;
  listSubjects(): Promise<DashboardSubject[]>;
  getEpisode(episodeId: number): Promise<EpisodeRow | null>;
  markEpisodeWatched(episodeId: number): Promise<void>;
  dismissEpisode(episodeId: number, dismissedAt: string): Promise<void>;
  getLastNotificationDate(): Promise<string | null>;
  setLastNotificationDate(date: string): Promise<void>;
};

export function createRepository(dbPath: string): Repository {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
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
      db.prepare(
        `insert into subjects (id, name, name_cn, eps, ep_status, image, url, updated_at)
         values (@id, @name, @nameCn, @eps, @epStatus, @image, @url, datetime('now'))
         on conflict(id) do update set
           name = excluded.name,
           name_cn = excluded.name_cn,
           eps = excluded.eps,
           ep_status = excluded.ep_status,
           image = excluded.image,
           url = excluded.url,
           updated_at = datetime('now')`
      ).run(subject);
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
            episode_type, sort, ep, name, name_cn, airdate, collection_type, dismissed_at
          ) values (
            @id, @subjectId, @subjectName, @subjectNameCn, @subjectUrl,
            @episodeType, @sort, @ep, @name, @nameCn, @airdate, @collectionType, @dismissedAt
          )`
        );
        for (const row of rows) {
          insert.run({ ...row, dismissedAt: existingDismissals.get(row.id) ?? row.dismissedAt });
        }
      });
      tx(episodes);
    },

    async listEpisodes() {
      return selectEpisodes(db, '');
    },

    async listSubjects() {
      const subjects = db
        .prepare(
          `select id, name, name_cn as nameCn, eps, ep_status as epStatus, image, url
           from subjects
           order by coalesce(nullif(name_cn, ''), name) collate nocase`
        )
        .all() as SubjectRow[];
      const mainEpisodes = selectEpisodes(db, 'where episode_type = 0');
      const bySubject = new Map<number, EpisodeRow>();
      const countsBySubject = new Map<number, number>();
      const unwatchedEpisodesBySubject = new Map<number, EpisodeRow[]>();
      for (const episode of mainEpisodes) {
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
        unwatchedMainEpisodeCount: countsBySubject.get(subject.id) ?? 0,
        unwatchedMainEpisodes: (unwatchedEpisodesBySubject.get(subject.id) ?? []).sort(compareEpisodeProgress)
      }));
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
      collection_type integer not null,
      dismissed_at text,
      foreign key(subject_id) references subjects(id) on delete cascade
    );

    create index if not exists episodes_subject_id_idx on episodes(subject_id);
    create index if not exists episodes_airdate_idx on episodes(airdate);
  `);
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
        collection_type as collectionType,
        dismissed_at as dismissedAt
       from episodes
       ${whereClause}
       order by airdate, subject_name_cn, subject_name, sort`
    )
    .all(...params) as EpisodeRow[];
}

function compareEpisode(a: EpisodeRow, b: EpisodeRow): number {
  const byAirdate = a.airdate.localeCompare(b.airdate);
  if (byAirdate !== 0) return byAirdate;
  return a.sort - b.sort;
}

function compareEpisodeProgress(a: EpisodeRow, b: EpisodeRow): number {
  return Number(a.ep ?? a.sort) - Number(b.ep ?? b.sort);
}
