import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('loadConfig', () => {
  it('preserves environment > local file > default file precedence with native dotenv syntax', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bwp-config-'));
    const keys = ['HOST', 'PORT', 'BANGUMI_CLIENT_ID', 'BANGUMI_CLIENT_SECRET'];
    const previous = keys.map((key) => process.env[key]);
    try {
      keys.forEach((key) => delete process.env[key]);
      process.env.HOST = '127.0.0.1';
      writeFileSync(join(dir, '.env.local'), 'HOST=0.0.0.0\nPORT=3888\nBANGUMI_CLIENT_SECRET="quoted=#value"\n');
      writeFileSync(join(dir, '.env'), 'PORT=3999\nBANGUMI_CLIENT_ID=test-app # comment\nBANGUMI_CLIENT_SECRET=fallback\n');
      expect(loadConfig(dir)).toMatchObject({
        host: '127.0.0.1', port: 3888, clientId: 'test-app', clientSecret: 'quoted=#value'
      });
    } finally {
      keys.forEach((key, index) => restoreEnv(key, previous[index]));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('listens on all interfaces by default so LAN devices can reach the app', () => {
    const previousHost = process.env.HOST;
    delete process.env.HOST;

    try {
      expect(loadConfig().host).toBe('0.0.0.0');
    } finally {
      restoreEnv('HOST', previousHost);
    }
  });

  it('allows the listen host to be overridden', () => {
    const previousHost = process.env.HOST;
    process.env.HOST = '127.0.0.1';

    try {
      expect(loadConfig().host).toBe('127.0.0.1');
    } finally {
      restoreEnv('HOST', previousHost);
    }
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
