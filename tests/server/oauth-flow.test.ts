import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createBangumiClient } from '../../src/server/bangumi-client.js';
import { createDashboardService } from '../../src/server/dashboard.js';
import { createRepository } from '../../src/server/db.js';
import { createOAuthManager } from '../../src/server/oauth.js';

describe('OAuth callback to user list flow', () => {
  it('stores the logged-in Bangumi user and syncs that account watching list', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'bwp-oauth-flow-')), 'app.sqlite');
    const repository = createRepository(dbPath);
    const collectionUrls: string[] = [];
    let refreshToken: string | null = null;

    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === 'https://bgm.tv/oauth/access_token') {
        return Response.json({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 604800,
          token_type: 'Bearer'
        });
      }

      expect(init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer access-token' }));

      if (url === 'https://api.bgm.tv/v0/me') {
        return Response.json({ id: 1, username: 'alice', nickname: 'Alice' });
      }

      if (url.startsWith('https://api.bgm.tv/v0/users/alice/collections?')) {
        collectionUrls.push(url);
        return Response.json({
          total: 1,
          data: [
            {
              subject_id: 123,
              type: 3,
              ep_status: 1,
              subject: {
                id: 123,
                name: 'Demo Anime',
                name_cn: '演示动画',
                eps: 12,
                images: { common: 'https://example.test/cover.jpg' }
              }
            }
          ]
        });
      }

      if (url === 'https://api.bgm.tv/v0/users/-/collections/123/episodes?limit=1000&offset=0') {
        return Response.json({
          total: 1,
          data: [
            {
              type: 0,
              updated_at: 0,
              episode: {
                id: 456,
                subject_id: 123,
                type: 0,
                sort: 1,
                ep: 1,
                name: 'Episode 1',
                name_cn: '第一集',
                airdate: '2026-07-01'
              }
            }
          ]
        });
      }

      throw new Error(`Unexpected Bangumi request: ${url}`);
    });

    const auth = createOAuthManager({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      baseUrl: 'http://127.0.0.1:3777',
      randomState: () => 'state-ok',
      fetch,
      settings: {
        get: (key) => repository.getSetting(key),
        set: (key, value) => repository.setSetting(key, value)
      },
      tokenStore: {
        getRefreshToken: async () => refreshToken,
        setRefreshToken: async (value) => {
          refreshToken = value;
        },
        deleteRefreshToken: async () => {
          refreshToken = null;
        }
      }
    });
    const client = createBangumiClient({
      fetch,
      getAccessToken: () => auth.getAccessToken(),
      userAgent: 'bangumi-watch-planner-test'
    });
    const dashboard = createDashboardService({ auth, client, repository });
    const app = buildApp({
      auth,
      dashboard,
      staticRoot: null,
      afterOAuthUserLoaded: async () => {
        const me = await client.getMe();
        await repository.setSetting('username', me.username);
        await repository.setSetting('nickname', me.nickname);
      }
    });

    await auth.createAuthorizationUrl();
    const callback = await app.inject({ method: 'GET', url: '/auth/callback?code=code-1&state=state-ok' });
    const status = await app.inject({ method: 'GET', url: '/api/auth/status' });
    const dashboardResponse = await app.inject({ method: 'GET', url: '/api/dashboard' });

    expect(callback.statusCode).toBe(302);
    expect(refreshToken).toBe('refresh-token');
    expect(status.json()).toMatchObject({
      authenticated: true,
      username: 'alice',
      nickname: 'Alice'
    });
    expect(collectionUrls).toHaveLength(1);
    expect(new URL(collectionUrls[0]).searchParams.get('limit')).toBe('50');
    expect(dashboardResponse.json()).toMatchObject({
      subjects: [
        expect.objectContaining({
          id: 123,
          name: 'Demo Anime',
          nameCn: '演示动画',
          eps: 12
        })
      ],
      pendingEpisodes: [
        expect.objectContaining({
          id: 456,
          subjectId: 123,
          subjectNameCn: '演示动画'
        })
      ]
    });

    await app.close();
  });
});
