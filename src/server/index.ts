import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { createBangumiClient } from './bangumi-client.js';
import { loadConfig } from './config.js';
import { createDashboardService } from './dashboard.js';
import { createRepository } from './db.js';
import { createTokenStore } from './keychain.js';
import { getRuntimePlatform, isBackgroundServiceInstalled } from './launch-agent.js';
import { createSystemNotifier } from './notifier.js';
import { createOAuthManager } from './oauth.js';
import { startScheduler } from './scheduler.js';
import { rebuildBacklogPlan, syncAnimeCollections } from './sync.js';

const config = loadConfig();
const apiToken = randomBytes(32).toString('base64url');
const repository = createRepository(config.dbPath);
const tokenStore = createTokenStore();

const auth = createOAuthManager({
  clientId: config.clientId,
  clientSecret: config.clientSecret,
  baseUrl: config.baseUrl,
  getCredentials: async () => ({
    clientId: (await repository.getSetting('oauth_client_id')) ?? '',
    clientSecret: (await repository.getSetting('oauth_client_secret')) ?? ''
  }),
  settings: {
    get: (key) => repository.getSetting(key),
    set: (key, value) => repository.setSetting(key, value)
  },
  tokenStore,
  getLaunchAgentInstalled: isBackgroundServiceInstalled,
  notificationsEnabled: async () => config.notificationsEnabled,
  runtimePlatform: getRuntimePlatform()
});

const client = createBangumiClient({
  getAccessToken: () => auth.getAccessToken(),
  userAgent: config.userAgent
});

const dashboard = createDashboardService({
  auth,
  client,
  repository,
  clock: () => new Date(),
  syncCollections: syncAnimeCollections,
  rebuildPlan: rebuildBacklogPlan
});
const staticRoot = resolve(process.cwd(), 'dist/client');

const app = buildApp({
  auth,
  dashboard,
  settings: {
    async saveOAuthConfig({ clientId, clientSecret }) {
      await repository.setSetting('oauth_client_id', clientId);
      await repository.setSetting('oauth_client_secret', clientSecret);
    }
  },
  staticRoot: existsSync(staticRoot) ? staticRoot : null,
  logger: true,
  apiToken,
  afterOAuthUserLoaded: async () => {
    const me = await client.getMe();
    await repository.setSetting('username', me.username);
    await repository.setSetting('nickname', me.nickname);
  }
});

startScheduler({
  dashboard,
  repository,
  notifier: createSystemNotifier(),
  cronExpression: config.reminderCron,
  notificationsEnabled: async () => config.notificationsEnabled
});

const calibrationKey = 'sync_calibration_incremental_v1';
void auth.getAuthStatus().then(async (status) => {
  if (!status.authenticated || await repository.getSetting(calibrationKey)) return;
  await dashboard.syncNow('full');
  await repository.setSetting(calibrationKey, new Date().toISOString());
}).catch(() => undefined);

app.listen({ host: config.host, port: config.port }).catch((error) => {
  app.log.error(error);
  process.exitCode = 1;
});
