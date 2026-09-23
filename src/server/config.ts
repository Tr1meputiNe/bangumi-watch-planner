import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

export type AppConfig = {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  host: string;
  port: number;
  dbPath: string;
  notificationsEnabled: boolean;
  reminderCron: string;
  userAgent: string;
};

export function loadConfig(cwd = process.cwd()): AppConfig {
  loadDotEnv(resolve(cwd, '.env.local'));
  loadDotEnv(resolve(cwd, '.env'));

  const baseUrl = process.env.APP_BASE_URL || 'http://127.0.0.1:3777';
  return {
    clientId: process.env.BANGUMI_CLIENT_ID || '',
    clientSecret: process.env.BANGUMI_CLIENT_SECRET || '',
    baseUrl,
    host: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT || '3777'),
    dbPath: resolve(cwd, process.env.DB_PATH || './data/bangumi-watch-planner.sqlite'),
    notificationsEnabled: (process.env.NOTIFICATIONS_ENABLED || 'true') === 'true',
    reminderCron: process.env.REMINDER_CRON || '0 20 * * *',
    userAgent: process.env.BANGUMI_USER_AGENT || 'a27/bangumi-watch-planner/1.0.0'
  };
}

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;

  for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
