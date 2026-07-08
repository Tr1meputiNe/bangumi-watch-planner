import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { createBangumiClient } from './bangumi-client.js';
import { loadConfig } from './config.js';
import { createDashboardService } from './dashboard.js';
import { createRepository } from './db.js';
import { createKeychainTokenStore } from './keychain.js';
import { isLaunchAgentInstalled } from './launch-agent.js';
import { createMacNotifier } from './notifier.js';
import { createOAuthManager } from './oauth.js';
import { startScheduler } from './scheduler.js';

const config = loadConfig();
const apiToken = randomBytes(32).toString('base64url');
const repository = createRepository(config.dbPath);
const tokenStore = createKeychainTokenStore();

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
  getLaunchAgentInstalled: isLaunchAgentInstalled,
  notificationsEnabled: async () => config.notificationsEnabled
});

const client = createBangumiClient({
  getAccessToken: () => auth.getAccessToken(),
  userAgent: config.userAgent
});

const dashboard = createDashboardService({ auth, client, repository });
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
  notifier: createMacNotifier(),
  cronExpression: config.reminderCron,
  notificationsEnabled: async () => config.notificationsEnabled
});

app.listen({ host: config.host, port: config.port }).catch((error) => {
  app.log.error(error);
  process.exitCode = 1;
});
