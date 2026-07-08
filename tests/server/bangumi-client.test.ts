import { describe, expect, it, vi } from 'vitest';
import { createBangumiClient } from '../../src/server/bangumi-client.js';

describe('Bangumi client', () => {
  it('sends the expected watched episode patch request', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 204, text: async () => '' }));
    const client = createBangumiClient({
      fetch,
      getAccessToken: async () => 'token-1',
      userAgent: 'tester/bangumi-watch-planner'
    });

    await client.markEpisodesWatched(123, [10, 11]);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.bgm.tv/v0/users/-/collections/123/episodes',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
          'User-Agent': 'tester/bangumi-watch-planner'
        }),
        body: JSON.stringify({ episode_id: [10, 11], type: 2 })
      })
    );
  });
});
