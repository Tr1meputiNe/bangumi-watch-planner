import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { ACCESS_SESSION_MAX_AGE_SECONDS } from './access-auth.js';
import type { AccessAuthService, DashboardService, OAuthConfigInput, OAuthManager, SettingsService } from './types.js';

type AppDeps = {
  auth: OAuthManager;
  dashboard: DashboardService;
  settings?: SettingsService;
  staticRoot: string | null;
  afterOAuthUserLoaded?: () => Promise<void>;
  logger?: boolean;
  apiToken?: string | null;
  access?: AccessAuthService;
};

const API_TOKEN_COOKIE = 'bwp_token';
const ACCESS_SESSION_COOKIE = 'bwp_session';
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_WINDOW_MS = 60_000;

export function buildApp({ auth, dashboard, settings, staticRoot, afterOAuthUserLoaded, logger = false, apiToken = null, access }: AppDeps) {
  const app = fastify({ logger });
  const loginFailures = new Map<string, { count: number; resetAt: number }>();

  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0];
    const publicAccessRoute = path === '/api/auth/status'
      || path === '/api/access/setup'
      || path === '/api/access/login';
    const protectedAccessRoute = path.startsWith('/api/') || path.startsWith('/auth/');
    if (access && protectedAccessRoute && !publicAccessRoute) {
      const sessionToken = parseCookieValue(request.headers.cookie, ACCESS_SESSION_COOKIE);
      if (!(await access.getStatus(sessionToken)).authenticated) {
        return reply.code(401).send({ error: '需要登录' });
      }
    }

    if (!apiToken) return;
    if (!request.url.startsWith('/api/')) return;
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    if (path === '/api/access/setup' || path === '/api/access/login') return;

    const headerToken = request.headers['x-bwp-token'];
    const cookieToken = parseCookieValue(request.headers.cookie, API_TOKEN_COOKIE);
    if (headerToken !== apiToken && cookieToken !== apiToken) {
      return reply.code(403).send({ error: 'Invalid local API token' });
    }
  });

  app.get('/api/auth/status', async (_request, reply) => {
    const accessStatus = access
      ? await access.getStatus(parseCookieValue(_request.headers.cookie, ACCESS_SESSION_COOKIE))
      : null;
    if (accessStatus && !accessStatus.authenticated) {
      return {
        authenticated: false,
        username: null,
        nickname: null,
        lastSyncAt: null,
        accessConfigured: accessStatus.configured,
        accessAuthenticated: false
      };
    }
    const status = await auth.getAuthStatus();
    if (apiToken) {
      reply.header('set-cookie', serializeLocalApiTokenCookie(apiToken));
    }
    return accessStatus
      ? { ...status, accessConfigured: accessStatus.configured, accessAuthenticated: true }
      : status;
  });

  app.post<{ Body: { password?: unknown } }>('/api/access/setup', async (request, reply) => {
    if (!access) return reply.code(404).send({ error: 'Access login is not available' });
    const password = requirePassword(request.body?.password);
    const sessionToken = await access.setup(password);
    setAccessCookies(reply, sessionToken, apiToken);
    return { configured: true, authenticated: true };
  });

  app.post<{ Body: { password?: unknown } }>('/api/access/login', async (request, reply) => {
    if (!access) return reply.code(404).send({ error: 'Access login is not available' });
    const blockedFor = getLoginBlockSeconds(loginFailures.get(request.ip));
    if (blockedFor > 0) {
      reply.header('retry-after', String(blockedFor));
      return reply.code(429).send({ error: '尝试次数过多，请稍后再试' });
    }
    const password = requirePassword(request.body?.password);
    let sessionToken: string;
    try {
      sessionToken = await access.login(password);
      loginFailures.delete(request.ip);
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 401) {
        loginFailures.set(request.ip, nextLoginFailure(loginFailures.get(request.ip)));
      }
      throw error;
    }
    setAccessCookies(reply, sessionToken, apiToken);
    return { configured: true, authenticated: true };
  });

  app.post('/api/access/logout', async (_request, reply) => {
    reply.header('set-cookie', [
      clearCookie(ACCESS_SESSION_COOKIE, 'Lax'),
      clearCookie(API_TOKEN_COOKIE)
    ]);
    return reply.code(204).send();
  });

  app.get('/auth/login', async (_request, reply) => {
    const url = await auth.createAuthorizationUrl();
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string } }>('/auth/callback', async (request, reply) => {
    const { code, state } = request.query;
    if (!code || !state) {
      return reply.code(400).type('text/plain').send('Missing OAuth code or state');
    }

    await auth.handleCallback(code, state);
    await afterOAuthUserLoaded?.();
    try {
      await dashboard.syncNow();
    } catch (error) {
      app.log.error(error);
    }
    return reply.redirect('/');
  });

  app.post('/api/sync', async (_request, reply) => reply.code(202).send(dashboard.startSync()));
  app.get('/api/sync/status', async () => dashboard.getSyncStatus());
  app.get('/api/dashboard', async () => dashboard.getDashboard());
  app.get('/api/backlog', async () => dashboard.getBacklog());
  app.get<{ Querystring: { q?: string; year?: string } }>('/api/wishlist', async (request) =>
    dashboard.getWishlist(request.query.q ?? '', parseWishlistYear(request.query.year))
  );
  app.get('/api/calendar', async () => dashboard.getCalendar());
  app.get<{ Querystring: { q?: string } }>('/api/search/anime', async (request) => ({
    results: await dashboard.searchAnimeSubjects(request.query.q ?? '')
  }));

  app.post<{ Body: OAuthConfigInput }>('/api/settings/oauth', async (request, reply) => {
    if (!request.body?.clientId?.trim() || !request.body?.clientSecret?.trim()) {
      return reply.code(400).send({ error: 'Bangumi App ID and App Secret are required' });
    }
    if (!settings) {
      return reply.code(500).send({ error: 'Settings service is not available' });
    }
    await settings.saveOAuthConfig({
      clientId: request.body.clientId.trim(),
      clientSecret: request.body.clientSecret.trim()
    });
    return reply.code(204).send();
  });

  app.post<{ Params: { episodeId: string } }>('/api/episodes/:episodeId/watched', async (request, reply) => {
    await dashboard.markEpisodeWatched(parsePositiveInteger(request.params.episodeId));
    return reply.code(204).send();
  });

  app.post<{ Params: { episodeId: string } }>('/api/episodes/:episodeId/unwatched', async (request, reply) => {
    await dashboard.markEpisodeUnwatched(parsePositiveInteger(request.params.episodeId));
    return reply.code(204).send();
  });

  app.post<{ Params: { subjectId: string }; Body: { episodeId?: number } }>('/api/subjects/:subjectId/watched-through', async (request, reply) => {
    await dashboard.markSubjectEpisodesWatchedThrough(
      parsePositiveInteger(request.params.subjectId),
      parsePositiveInteger(String(request.body?.episodeId ?? ''))
    );
    return reply.code(204).send();
  });

  app.post<{ Params: { subjectId: string } }>('/api/subjects/:subjectId/watching', async (request) =>
    dashboard.addSubjectToWatching(parsePositiveInteger(request.params.subjectId))
  );

  app.post<{ Params: { subjectId: string } }>('/api/subjects/:subjectId/wishlist', async (request) =>
    dashboard.addSubjectToWishlist(parsePositiveInteger(request.params.subjectId))
  );

  app.post<{ Params: { subjectId: string } }>('/api/subjects/:subjectId/start', async (request) =>
    dashboard.startSubject(parsePositiveInteger(request.params.subjectId))
  );

  app.post<{ Params: { subjectId: string } }>('/api/backlog/:subjectId/pause', async (request, reply) => {
    await dashboard.pauseBacklogSubject(parsePositiveInteger(request.params.subjectId));
    return reply.code(204).send();
  });

  app.post<{ Params: { subjectId: string } }>('/api/backlog/:subjectId/resume', async (request, reply) => {
    await dashboard.resumeBacklogSubject(parsePositiveInteger(request.params.subjectId));
    return reply.code(204).send();
  });

  app.post<{ Params: { subjectId: string } }>('/api/backlog/:subjectId/complete', async (request, reply) => {
    await dashboard.completeBacklogSubject(parsePositiveInteger(request.params.subjectId));
    return reply.code(204).send();
  });

  app.post<{ Params: { episodeId: string } }>('/api/backlog/tasks/:episodeId/swap', async (request, reply) => {
    await dashboard.swapBacklogTask(parsePositiveInteger(request.params.episodeId));
    return reply.code(204).send();
  });

  app.post('/api/backlog/today/skip', async (_request, reply) => {
    await dashboard.skipBacklogToday();
    return reply.code(204).send();
  });

  app.post('/api/backlog/today/replan', async (_request, reply) => {
    await dashboard.replanBacklogToday();
    return reply.code(204).send();
  });

  app.post<{ Params: { episodeId: string } }>('/api/reminders/:episodeId/dismiss', async (request, reply) => {
    await dashboard.dismissEpisode(parsePositiveInteger(request.params.episodeId));
    return reply.code(204).send();
  });

  app.post<{ Params: { episodeId: string } }>('/api/reminders/:episodeId/tomorrow', async (request, reply) => {
    await dashboard.snoozeEpisodeUntilTomorrow(parsePositiveInteger(request.params.episodeId));
    return reply.code(204).send();
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const typedError = error as Error & { expose?: boolean; statusCode?: number };
    const statusCode = typedError.statusCode && typedError.statusCode >= 400 ? typedError.statusCode : 500;
    const message = statusCode >= 500 && !typedError.expose ? 'Internal server error' : typedError.message;
    return reply.code(statusCode).send({ error: message });
  });

  if (staticRoot) {
    void app.register(fastifyStatic, {
      root: staticRoot,
      prefix: '/'
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(parsed)) {
    throw Object.assign(new Error('Id must be a positive integer'), { statusCode: 400 });
  }
  return parsed;
}

function parseWishlistYear(value: string | undefined): number | null | 'unknown' {
  if (!value || value === 'all') return null;
  if (value === 'unknown') return 'unknown';
  if (!/^\d{4}$/.test(value)) {
    throw Object.assign(new Error('Year must be all, unknown, or a four-digit year'), { statusCode: 400 });
  }
  return Number(value);
}

function serializeLocalApiTokenCookie(token: string): string {
  return `${API_TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`;
}

function serializeAccessSessionCookie(token: string): string {
  return `${ACCESS_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ACCESS_SESSION_MAX_AGE_SECONDS}`;
}

function clearCookie(name: string, sameSite: 'Lax' | 'Strict' = 'Strict'): string {
  return `${name}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0`;
}

function setAccessCookies(reply: { header(name: string, value: string | string[]): unknown }, sessionToken: string, apiToken: string | null): void {
  reply.header('set-cookie', [
    serializeAccessSessionCookie(sessionToken),
    ...(apiToken ? [serializeLocalApiTokenCookie(apiToken)] : [])
  ]);
}

function requirePassword(value: unknown): string {
  if (typeof value !== 'string') {
    throw Object.assign(new Error('请输入密码'), { statusCode: 400, expose: true });
  }
  return value;
}

function nextLoginFailure(current: { count: number; resetAt: number } | undefined): { count: number; resetAt: number } {
  const now = Date.now();
  if (!current || current.resetAt <= now) {
    return { count: 1, resetAt: now + LOGIN_WINDOW_MS };
  }
  return { ...current, count: current.count + 1 };
}

function getLoginBlockSeconds(current: { count: number; resetAt: number } | undefined): number {
  if (!current || current.count < LOGIN_ATTEMPT_LIMIT || current.resetAt <= Date.now()) return 0;
  return Math.max(1, Math.ceil((current.resetAt - Date.now()) / 1000));
}

function parseCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  for (const rawCookie of cookieHeader.split(';')) {
    const [rawName, ...rawValueParts] = rawCookie.trim().split('=');
    if (rawName !== name) {
      continue;
    }
    const rawValue = rawValueParts.join('=');
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}
