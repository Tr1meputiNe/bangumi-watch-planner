import { describe, expect, it, vi } from 'vitest';
import { syncWatchingAnime } from '../../src/server/sync.js';
import type { BangumiClient } from '../../src/server/types.js';

describe('syncWatchingAnime', () => {
  it('uses Bangumi collection page size within the official API limit by default', async () => {
    const client: BangumiClient = {
      getMe: vi.fn(),
      getCalendar: vi.fn(async () => []),
      getWatchingAnime: vi.fn(async () => ({
        total: 0,
        data: []
      })),
      getSubjectEpisodes: vi.fn(),
      markEpisodesWatched: vi.fn(),
      markEpisodesUnwatched: vi.fn()
    };

    await syncWatchingAnime({
      username: 'sai',
      client,
      repository: {
        upsertSubject: async () => undefined,
        replaceSubjectEpisodes: async () => undefined,
        setSetting: async () => undefined
      }
    });

    expect(client.getWatchingAnime).toHaveBeenCalledWith('sai', 50, 0);
  });

  it('fetches all watching anime pages and stores their episode collections', async () => {
    const client: BangumiClient = {
      getMe: vi.fn(),
      getCalendar: vi.fn(async () => []),
      getWatchingAnime: vi
        .fn()
        .mockResolvedValueOnce({
          total: 51,
          data: [
            {
              subject_id: 1,
              type: 3,
              ep_status: 1,
              subject: {
                id: 1,
                name: 'One',
                name_cn: '一号',
                eps: 12,
                images: { common: 'cover-1' }
              }
            }
          ]
        })
        .mockResolvedValueOnce({
          total: 51,
          data: [
            {
              subject_id: 2,
              type: 3,
              ep_status: 0,
              subject: {
                id: 2,
                name: 'Two',
                name_cn: '',
                eps: 10,
                images: { common: 'cover-2' }
              }
            }
          ]
        }),
      getSubjectEpisodes: vi
        .fn()
        .mockResolvedValueOnce({
          total: 1,
          data: [
            {
              type: 0,
              updated_at: 0,
              episode: {
                id: 11,
                subject_id: 1,
                type: 0,
                sort: 1,
                ep: 1,
                name: 'first',
                name_cn: '第一集',
                airdate: '2026-07-01'
              }
            }
          ]
        })
        .mockResolvedValueOnce({
          total: 1,
          data: [
            {
              type: 2,
              updated_at: 0,
              episode: {
                id: 21,
                subject_id: 2,
                type: 0,
                sort: 1,
                ep: 1,
                name: 'first',
                name_cn: '',
                airdate: '2026-07-08'
              }
            }
          ]
        }),
      markEpisodesWatched: vi.fn(),
      markEpisodesUnwatched: vi.fn(),
      getBroadcastTimes: vi.fn(async () => new Map([[1, { airDate: '2026-07-09', airTime: '22:30', dayOffset: 0 }]]))
    };
    const savedSubjects: any[] = [];
    const savedEpisodes: any[] = [];

    const result = await syncWatchingAnime({
      username: 'sai',
      pageSize: 50,
      client,
      repository: {
        upsertSubject: async (subject) => savedSubjects.push(subject),
        replaceSubjectEpisodes: async (_subjectId, episodes) => savedEpisodes.push(...episodes),
        setSetting: async () => undefined
      }
    });

    expect(result.subjectsSynced).toBe(2);
    expect(result.episodesSynced).toBe(2);
    expect(client.getWatchingAnime).toHaveBeenNthCalledWith(1, 'sai', 50, 0);
    expect(client.getWatchingAnime).toHaveBeenNthCalledWith(2, 'sai', 50, 50);
    expect(savedSubjects.map((subject) => subject.id)).toEqual([1, 2]);
    expect(savedEpisodes.map((episode) => episode.id)).toEqual([11, 21]);
    expect(savedEpisodes.find((episode) => episode.id === 11)?.airdate).toBe('2026-07-01');
    expect(savedEpisodes.find((episode) => episode.id === 11)?.airTime).toBe('22:30');
    expect(savedEpisodes.find((episode) => episode.id === 21)?.airTime).toBe('');
  });

  it('paginates episode collections for each subject', async () => {
    const client: BangumiClient = {
      getMe: vi.fn(),
      getCalendar: vi.fn(async () => []),
      getWatchingAnime: vi.fn(async () => ({
        total: 1,
        data: [
          {
            subject_id: 1,
            type: 3,
            ep_status: 0,
            subject: {
              id: 1,
              name: 'One',
              name_cn: '',
              eps: 1001,
              images: {}
            }
          }
        ]
      })),
      getSubjectEpisodes: vi
        .fn()
        .mockResolvedValueOnce({
          total: 1001,
          data: [
            {
              type: 0,
              updated_at: 0,
              episode: { id: 1, subject_id: 1, type: 0, sort: 1, ep: 1, name: 'one', name_cn: '', airdate: '2026-07-01' }
            }
          ]
        })
        .mockResolvedValueOnce({
          total: 1001,
          data: [
            {
              type: 0,
              updated_at: 0,
              episode: { id: 1001, subject_id: 1, type: 0, sort: 1001, ep: 1001, name: 'last', name_cn: '', airdate: '2026-07-02' }
            }
          ]
        }),
      markEpisodesWatched: vi.fn(),
      markEpisodesUnwatched: vi.fn()
    };
    const savedEpisodes: any[] = [];

    const result = await syncWatchingAnime({
      username: 'sai',
      client,
      repository: {
        upsertSubject: async () => undefined,
        replaceSubjectEpisodes: async (_subjectId, episodes) => savedEpisodes.push(...episodes),
        setSetting: async () => undefined
      }
    });

    expect(result.episodesSynced).toBe(2);
    expect(client.getSubjectEpisodes).toHaveBeenNthCalledWith(1, 1, 1000, 0);
    expect(client.getSubjectEpisodes).toHaveBeenNthCalledWith(2, 1, 1000, 1000);
    expect(savedEpisodes.map((episode) => episode.id)).toEqual([1, 1001]);
  });

  it('keeps subject eps when the episode collection page has fewer known main episodes', async () => {
    const client: BangumiClient = {
      getMe: vi.fn(),
      getCalendar: vi.fn(async () => []),
      getWatchingAnime: vi.fn(async () => ({
        total: 1,
        data: [
          {
            subject_id: 1,
            type: 3,
            ep_status: 1,
            subject: {
              id: 1,
              name: 'One',
              name_cn: '',
              eps: 12,
              images: {}
            }
          }
        ]
      })),
      getSubjectEpisodes: vi.fn(async () => ({
        total: 3,
        data: [
          {
            type: 2,
            updated_at: 0,
            episode: { id: 11, subject_id: 1, type: 0, sort: 1, ep: 1, name: 'one', name_cn: '', airdate: '2026-07-01' }
          },
          {
            type: 0,
            updated_at: 0,
            episode: { id: 12, subject_id: 1, type: 0, sort: 2, ep: 2, name: 'two', name_cn: '', airdate: '2026-07-08' }
          },
          {
            type: 0,
            updated_at: 0,
            episode: { id: 13, subject_id: 1, type: 0, sort: 3, ep: 3, name: 'three', name_cn: '', airdate: '2026-07-15' }
          }
        ]
      })),
      markEpisodesWatched: vi.fn(),
      markEpisodesUnwatched: vi.fn(),
      addSubjectToWatching: vi.fn(),
      searchAnimeSubjects: vi.fn()
    };
    const savedSubjects: any[] = [];

    await syncWatchingAnime({
      username: 'sai',
      client,
      repository: {
        upsertSubject: async (subject) => savedSubjects.push(subject),
        replaceSubjectEpisodes: async () => undefined,
        setSetting: async () => undefined
      }
    });

    expect(savedSubjects[0].eps).toBe(12);
  });

  it('uses main episode count from episode collections when subject eps is missing', async () => {
    const client: BangumiClient = {
      getMe: vi.fn(),
      getCalendar: vi.fn(async () => []),
      getWatchingAnime: vi.fn(async () => ({
        total: 1,
        data: [
          {
            subject_id: 1,
            type: 3,
            ep_status: 1,
            subject: {
              id: 1,
              name: 'One',
              name_cn: '',
              eps: 0,
              images: {}
            }
          }
        ]
      })),
      getSubjectEpisodes: vi.fn(async () => ({
        total: 3,
        data: [
          {
            type: 2,
            updated_at: 0,
            episode: { id: 11, subject_id: 1, type: 0, sort: 1, ep: 1, name: 'one', name_cn: '', airdate: '2026-07-01' }
          },
          {
            type: 0,
            updated_at: 0,
            episode: { id: 12, subject_id: 1, type: 0, sort: 2, ep: 2, name: 'two', name_cn: '', airdate: '2026-07-08' }
          },
          {
            type: 0,
            updated_at: 0,
            episode: { id: 13, subject_id: 1, type: 1, sort: 1, name: 'sp', name_cn: '', airdate: '2026-07-09' }
          }
        ]
      })),
      markEpisodesWatched: vi.fn(),
      markEpisodesUnwatched: vi.fn(),
      addSubjectToWatching: vi.fn(),
      searchAnimeSubjects: vi.fn()
    };
    const savedSubjects: any[] = [];

    await syncWatchingAnime({
      username: 'sai',
      client,
      repository: {
        upsertSubject: async (subject) => savedSubjects.push(subject),
        replaceSubjectEpisodes: async () => undefined,
        setSetting: async () => undefined
      }
    });

    expect(savedSubjects[0].eps).toBe(2);
  });

  it('uses the highest known main episode number when subject eps is missing and episodes are sparse', async () => {
    const client: BangumiClient = {
      getMe: vi.fn(),
      getCalendar: vi.fn(async () => []),
      getWatchingAnime: vi.fn(async () => ({
        total: 1,
        data: [
          {
            subject_id: 1,
            type: 3,
            ep_status: 5,
            subject: {
              id: 1,
              name: 'One',
              name_cn: '',
              eps: 0,
              images: {}
            }
          }
        ]
      })),
      getSubjectEpisodes: vi.fn(async () => ({
        total: 3,
        data: [
          {
            type: 2,
            updated_at: 0,
            episode: { id: 11, subject_id: 1, type: 0, sort: 1, ep: 1, name: 'one', name_cn: '', airdate: '2026-07-01' }
          },
          {
            type: 2,
            updated_at: 0,
            episode: { id: 15, subject_id: 1, type: 0, sort: 5, ep: 5, name: 'five', name_cn: '', airdate: '2026-07-08' }
          },
          {
            type: 0,
            updated_at: 0,
            episode: { id: 22, subject_id: 1, type: 0, sort: 12, ep: 12, name: 'twelve', name_cn: '', airdate: '2026-09-16' }
          }
        ]
      })),
      markEpisodesWatched: vi.fn(),
      markEpisodesUnwatched: vi.fn(),
      addSubjectToWatching: vi.fn(),
      searchAnimeSubjects: vi.fn()
    };
    const savedSubjects: any[] = [];

    await syncWatchingAnime({
      username: 'sai',
      client,
      repository: {
        upsertSubject: async (subject) => savedSubjects.push(subject),
        replaceSubjectEpisodes: async () => undefined,
        setSetting: async () => undefined
      }
    });

    expect(savedSubjects[0].eps).toBe(12);
  });
});
