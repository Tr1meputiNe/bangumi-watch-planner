import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTokenStore, createWindowsTokenStore } from '../../src/server/keychain.js';
import { getRuntimePlatform, isBackgroundServiceInstalled } from '../../src/server/launch-agent.js';
import { createWindowsNotifier } from '../../src/server/notifier.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('platform adapters', () => {
  it('stores refresh tokens in a private file on non-desktop deployments', async () => {
    const directory = await makeTemporaryDirectory();
    const path = join(directory, 'tokens', 'refresh-token');
    const store = createTokenStore({ platform: 'linux', path });

    await store.setRefreshToken('secret-token');

    expect(await store.getRefreshToken()).toBe('secret-token');
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
    await store.deleteRefreshToken();
    expect(await store.getRefreshToken()).toBeNull();
  });

  it('passes Windows refresh tokens through CurrentUser DPAPI without placing them in the command', async () => {
    const directory = await makeTemporaryDirectory();
    const path = join(directory, 'refresh-token.dat');
    const powershell = vi.fn(async (script: string, input = '', env: NodeJS.ProcessEnv = {}) => {
      expect(env.BWP_TOKEN_PATH).toBe(path);
      if (script.includes('Unprotect')) return 'secret-token';
      expect(script).toContain('DataProtectionScope]::CurrentUser');
      expect(input).toBe('secret-token');
      await writeFile(path, 'encrypted');
      return '';
    });
    const store = createWindowsTokenStore(path, powershell);

    await store.setRefreshToken('secret-token');

    expect(await store.getRefreshToken()).toBe('secret-token');
    expect(powershell).toHaveBeenCalledTimes(2);
  });

  it('encodes Windows notification text and detects its startup shortcut', async () => {
    const powershell = vi.fn(async (_script: string, _input = '', env: NodeJS.ProcessEnv = {}) => {
      expect(_input).toBe('');
      expect(Buffer.from(env.BWP_NOTIFICATION_TITLE ?? '', 'base64').toString()).toBe('追番提醒');
      expect(Buffer.from(env.BWP_NOTIFICATION_BODY ?? '', 'base64').toString()).toBe('还有 2 集未看');
      return '';
    });
    await createWindowsNotifier(powershell).notify('追番提醒', '还有 2 集未看');

    const appData = await makeTemporaryDirectory();
    const startup = join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    await mkdir(startup, { recursive: true });
    await writeFile(join(startup, 'Bangumi Watch Planner.lnk'), '');

    expect(getRuntimePlatform('win32')).toBe('Windows');
    expect(await isBackgroundServiceInstalled('win32', appData)).toBe(true);
  });
});

async function makeTemporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'bangumi-watch-planner-'));
  temporaryDirectories.push(path);
  return path;
}
