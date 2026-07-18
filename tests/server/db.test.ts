import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepository, type Repository } from '../../src/server/db.js';

describe('repository', () => {
  let tempDir: string;
  let repository: Repository;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bwp-db-'));
    repository = createRepository(join(tempDir, 'test.sqlite'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('updates the subject watched progress when marking an episode watched locally', async () => {
    await repository.upsertSubject({
      id: 1,
      name: 'Test Anime',
      nameCn: '测试番剧',
      eps: 12,
      epStatus: 1,
      image: null,
      url: 'https://bgm.tv/subject/1'
    });
    await repository.replaceSubjectEpisodes(1, [
      episode({ id: 11, sort: 2, ep: 2, collectionType: 0 }),
      episode({ id: 12, sort: 3, ep: 3, collectionType: 0 })
    ]);

    await repository.markEpisodeWatched(11);

    const subjects = await repository.listSubjects();
    expect(subjects[0]).toMatchObject({
      epStatus: 2,
      nextEpisode: expect.objectContaining({ id: 12, sort: 3 })
    });
  });

  it('recomputes subject progress and pending episodes when marking an episode unwatched locally', async () => {
    await repository.upsertSubject({
      id: 1,
      name: 'Test Anime',
      nameCn: '测试番剧',
      eps: 12,
      epStatus: 3,
      image: null,
      url: 'https://bgm.tv/subject/1'
    });
    await repository.replaceSubjectEpisodes(1, [
      episode({ id: 10, sort: 1, ep: 1, collectionType: 2 }),
      episode({ id: 11, sort: 2, ep: 2, collectionType: 2 }),
      episode({ id: 12, sort: 3, ep: 3, collectionType: 0 })
    ]);

    await repository.markEpisodeUnwatched(11);

    const subjects = await repository.listSubjects();
    expect(subjects[0]).toMatchObject({
      epStatus: 1,
      nextEpisode: expect.objectContaining({ id: 11 }),
      mainEpisodes: [
        expect.objectContaining({ id: 10, collectionType: 2 }),
        expect.objectContaining({ id: 11, collectionType: 0 }),
        expect.objectContaining({ id: 12, collectionType: 0 })
      ],
      unwatchedMainEpisodeCount: 2
    });
  });

  it('counts all unwatched main episodes for each subject', async () => {
    await repository.upsertSubject({
      id: 1,
      name: 'Test Anime',
      nameCn: '测试番剧',
      eps: 12,
      epStatus: 1,
      image: null,
      url: 'https://bgm.tv/subject/1'
    });
    await repository.replaceSubjectEpisodes(1, [
      episode({ id: 11, sort: 2, ep: 2, collectionType: 0 }),
      episode({ id: 12, sort: 3, ep: 3, collectionType: 0 }),
      episode({ id: 13, sort: 4, ep: 4, collectionType: 2 }),
      episode({ id: 14, sort: 1, ep: null, episodeType: 1, collectionType: 0 })
    ]);

    const subjects = await repository.listSubjects();

    expect(subjects[0]).toMatchObject({
      unwatchedMainEpisodeCount: 2,
      nextEpisode: expect.objectContaining({ id: 11 }),
      mainEpisodes: [
        expect.objectContaining({ id: 11, sort: 2 }),
        expect.objectContaining({ id: 12, sort: 3 }),
        expect.objectContaining({ id: 13, sort: 4 })
      ],
      unwatchedMainEpisodes: [
        expect.objectContaining({ id: 11, sort: 2 }),
        expect.objectContaining({ id: 12, sort: 3 })
      ]
    });
  });

  it('orders subjects by the nearest next episode broadcast time', async () => {
    await repository.upsertSubject({
      id: 1,
      name: 'A Late Anime',
      nameCn: 'A 晚播',
      eps: 12,
      epStatus: 1,
      image: null,
      url: 'https://bgm.tv/subject/1'
    });
    await repository.upsertSubject({
      id: 2,
      name: 'Z Early Anime',
      nameCn: 'Z 早播',
      eps: 12,
      epStatus: 1,
      image: null,
      url: 'https://bgm.tv/subject/2'
    });
    await repository.replaceSubjectEpisodes(1, [episode({ id: 11, subjectId: 1, subjectName: 'A Late Anime', subjectNameCn: 'A 晚播', airTime: '23:30' })]);
    await repository.replaceSubjectEpisodes(2, [episode({ id: 21, subjectId: 2, subjectName: 'Z Early Anime', subjectNameCn: 'Z 早播', airTime: '21:00' })]);

    const subjects = await repository.listSubjects();

    expect(subjects.map((subject) => subject.id)).toEqual([2, 1]);
  });

  it('migrates old subjects without losing progress', async () => {
    const dbPath = join(tempDir, 'old.sqlite');
    const db = new Database(dbPath);
    db.exec(`
      create table subjects (
        id integer primary key,
        name text not null,
        name_cn text not null,
        eps integer not null,
        ep_status integer not null,
        image text,
        url text not null,
        updated_at text not null
      );
      insert into subjects values (1, 'Test Anime', '测试番剧', 12, 3, null, 'https://bgm.tv/subject/1', '2026-07-19T00:00:00Z');
    `);
    db.close();

    const migrated = createRepository(dbPath);

    expect(await migrated.getSubject(1)).toMatchObject({
      id: 1,
      epStatus: 3,
      collectionType: 3,
      plannerMode: 'seasonal',
      seasonKey: null,
      seasonKind: null,
      airYear: null,
      totalEpisodesKnown: false,
      completedAt: null
    });
  });

  it('separates seasonal, backlog, held, wishlist, and completed subjects', async () => {
    for (const subject of [
      { id: 1, name: 'Seasonal', nameCn: 'Seasonal' },
      { id: 2, name: 'Backlog', nameCn: 'Backlog' },
      { id: 3, name: 'Held', nameCn: 'Held' },
      { id: 4, name: 'Wishlist', nameCn: 'Wishlist', collectionType: 1, plannerMode: null },
      { id: 5, name: 'Completed', nameCn: 'Completed' }
    ]) {
      await repository.upsertSubject({ ...baseSubject(), ...subject });
    }
    await repository.setSubjectState(2, { collectionType: 3, plannerMode: 'backlog', completedAt: null });
    await repository.setSubjectState(3, { collectionType: 4, plannerMode: null, completedAt: null });
    await repository.setSubjectState(5, { collectionType: 2, plannerMode: null, completedAt: '2026-07-19T00:00:00+08:00' });

    await expect(repository.listSubjectsByMode('seasonal', [3])).resolves.toEqual([
      expect.objectContaining({ id: 1, plannerMode: 'seasonal' })
    ]);
    await expect(repository.listSubjectsByMode('backlog', [3])).resolves.toEqual([
      expect.objectContaining({ id: 2, plannerMode: 'backlog' })
    ]);
    await expect(repository.listSubjectsByCollection([4])).resolves.toEqual([expect.objectContaining({ id: 3 })]);
    await expect(repository.listSubjectsByCollection([2])).resolves.toEqual([expect.objectContaining({ id: 5 })]);
    await expect(repository.listWishlist('', null)).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 4, plannerMode: null })],
      years: []
    });
  });

  it('replaces only unlocked tasks in the requested range', async () => {
    await repository.upsertSubject(baseSubject());
    await repository.upsertSubject({ ...baseSubject(), id: 2, name: 'Second Anime', nameCn: '第二部番剧' });
    await repository.replaceSubjectEpisodes(1, [episode({ id: 11, airdate: '2026-07-19' })]);
    await repository.replaceSubjectEpisodes(2, [episode({ id: 21, subjectId: 2, subjectName: 'Second Anime', subjectNameCn: '第二部番剧', airdate: '2026-07-20' })]);
    await repository.replaceBacklogTasks({
      fromDate: '2026-07-19',
      throughDate: '2026-07-19',
      preserveLocked: false,
      tasks: [task({ episodeId: 11, plannedDate: '2026-07-19', locked: true })]
    });
    await repository.replaceBacklogTasks({
      fromDate: '2026-07-20',
      throughDate: '2026-07-25',
      preserveLocked: true,
      tasks: [task({ episodeId: 21, subjectId: 2, plannedDate: '2026-07-20', slot: 0, locked: false })]
    });

    expect(await repository.listBacklogTasks('2026-07-19', '2026-07-25')).toEqual([
      expect.objectContaining({ episodeId: 11, plannedDate: '2026-07-19', locked: true }),
      expect.objectContaining({ episodeId: 21, plannedDate: '2026-07-20', locked: false })
    ]);
  });

  it('stores planner overrides by Shanghai date', async () => {
    await repository.upsertSubject(baseSubject());
    await repository.replaceSubjectEpisodes(1, [episode({ id: 21 })]);
    await repository.skipBacklogDate('2026-07-19');
    await repository.excludeEpisodeOnDate('2026-07-20', 21);

    await expect(repository.listSkippedBacklogDates('2026-07-19', '2026-07-25')).resolves.toEqual(['2026-07-19']);
    await expect(repository.listBacklogExclusions('2026-07-19', '2026-07-25')).resolves.toEqual([
      { plannedDate: '2026-07-20', episodeId: 21 }
    ]);
  });
});

function episode(overrides: Partial<ReturnType<typeof baseEpisode>>) {
  return { ...baseEpisode(), ...overrides };
}

function baseEpisode() {
  return {
    id: 11,
    subjectId: 1,
    subjectName: 'Test Anime',
    subjectNameCn: '测试番剧',
    subjectUrl: 'https://bgm.tv/subject/1',
    episodeType: 0,
    sort: 2,
    ep: 2,
    name: 'episode',
    nameCn: '第 2 集',
    airdate: '2026-07-08',
    airTime: '',
    collectionType: 0,
    dismissedAt: null
  };
}

function baseSubject() {
  return {
    id: 1,
    name: 'Test Anime',
    nameCn: '测试番剧',
    eps: 12,
    epStatus: 1,
    image: null,
    url: 'https://bgm.tv/subject/1'
  };
}

function task(overrides: Partial<{ episodeId: number; subjectId: number; plannedDate: string; slot: number; locked: boolean }> = {}) {
  return {
    episodeId: 11,
    subjectId: 1,
    plannedDate: '2026-07-20',
    slot: 0,
    locked: false,
    ...overrides
  };
}
