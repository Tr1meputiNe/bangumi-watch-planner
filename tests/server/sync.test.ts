import { describe, expect, it, vi } from 'vitest';
import { syncWatchingAnime } from '../../src/server/sync.js';
import type { BangumiClient } from '../../src/server/types.js';

describe('syncWatchingAnime', () => {
  it('fetches all watching anime pages and stores their episode collections', async () => {
    const client: BangumiClient = {
      getMe: vi.fn(),
      getWatchingAnime: vi
        .fn()
        .mockResolvedValueOnce({
          total: 101,
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
          total: 101,
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
      markEpisodesWatched: vi.fn()
    };
    const savedSubjects: any[] = [];
    const savedEpisodes: any[] = [];

    const result = await syncWatchingAnime({
      username: 'sai',
      pageSize: 100,
      client,
      repository: {
        upsertSubject: async (subject) => savedSubjects.push(subject),
        replaceSubjectEpisodes: async (_subjectId, episodes) => savedEpisodes.push(...episodes),
        setSetting: async () => undefined
      }
    });

    expect(result.subjectsSynced).toBe(2);
    expect(result.episodesSynced).toBe(2);
    expect(client.getWatchingAnime).toHaveBeenNthCalledWith(1, 'sai', 100, 0);
    expect(client.getWatchingAnime).toHaveBeenNthCalledWith(2, 'sai', 100, 100);
    expect(savedSubjects.map((subject) => subject.id)).toEqual([1, 2]);
    expect(savedEpisodes.map((episode) => episode.id)).toEqual([11, 21]);
  });

  it('paginates episode collections for each subject', async () => {
    const client: BangumiClient = {
      getMe: vi.fn(),
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
      markEpisodesWatched: vi.fn()
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
});
