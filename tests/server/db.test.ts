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
    collectionType: 0,
    dismissedAt: null
  };
}
