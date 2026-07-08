import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config.js';

describe('loadConfig', () => {
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
