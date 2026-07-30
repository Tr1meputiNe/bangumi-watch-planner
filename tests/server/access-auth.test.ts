import { describe, expect, it } from 'vitest';
import { ACCESS_SESSION_MAX_AGE_SECONDS, createAccessAuthService } from '../../src/server/access-auth.js';

describe('access auth service', () => {
  it('stores a password hash and keeps the signed session valid across service restarts', async () => {
    const values = new Map<string, string>();
    const settings = mapSettings(values);
    const first = createAccessAuthService({ settings, now: () => 1_000_000 });

    await expect(first.getStatus(null)).resolves.toEqual({ configured: false, authenticated: false });
    const token = await first.setup('correct horse');

    expect(values.get('access_password_hash')).toMatch(/^scrypt\$/);
    expect(values.get('access_password_hash')).not.toContain('correct horse');
    await expect(first.getStatus(token)).resolves.toEqual({ configured: true, authenticated: true });

    const restarted = createAccessAuthService({ settings, now: () => 1_000_000 });
    await expect(restarted.getStatus(token)).resolves.toEqual({ configured: true, authenticated: true });
  });

  it('rejects short setup passwords and a second setup', async () => {
    const service = createAccessAuthService({ settings: mapSettings() });

    await expect(service.setup('short')).rejects.toMatchObject({ statusCode: 400 });
    await service.setup('long-enough');
    await expect(service.setup('another-password')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects an incorrect password without issuing a session', async () => {
    const service = createAccessAuthService({ settings: mapSettings() });
    await service.setup('correct horse');

    await expect(service.login('wrong password')).rejects.toMatchObject({
      statusCode: 401,
      message: '密码错误'
    });
    await expect(service.login('correct horse')).resolves.toMatch(/^\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('rejects expired and malformed sessions', async () => {
    let now = 1_000_000;
    const service = createAccessAuthService({ settings: mapSettings(), now: () => now });
    const token = await service.setup('correct horse');

    now += (ACCESS_SESSION_MAX_AGE_SECONDS + 1) * 1000;
    await expect(service.getStatus(token)).resolves.toEqual({ configured: true, authenticated: false });
    await expect(service.getStatus('not-a-session')).resolves.toEqual({ configured: true, authenticated: false });
  });
});

function mapSettings(values = new Map<string, string>()) {
  return {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
    }
  };
}
