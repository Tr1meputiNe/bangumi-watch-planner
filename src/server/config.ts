import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
    userAgent: process.env.BANGUMI_USER_AGENT || 'a27/bangumi-watch-planner/0.1.0'
  };
}

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;

  const contents = readFileSync(path, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    const rawValue = trimmed.slice(equals + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, '');
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
