import { describe, expect, it, vi } from 'vitest';

const execFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile }));

import { createKeychainTokenStore } from '../../src/server/keychain.js';

describe('macOS Keychain token updates', () => {
  it('keeps the old token if updating it fails', async () => {
    let stored = 'old-refresh';
    execFile.mockImplementation((_command, args: string[], callback) => {
      if (args[0] === 'add-generic-password') {
        callback(new Error('Keychain unavailable'));
      } else if (args[0] === 'find-generic-password') {
        callback(null, { stdout: `${stored}\n`, stderr: '' });
      } else if (args[0] === 'delete-generic-password') {
        stored = '';
        callback(null, { stdout: '', stderr: '' });
      }
    });
    const store = createKeychainTokenStore('test-service', 'test-account');

    await expect(store.setRefreshToken('new-refresh')).rejects.toThrow('Keychain unavailable');
    expect(await store.getRefreshToken()).toBe('old-refresh');
    expect(execFile.mock.calls.map(([, args]) => args[0])).not.toContain('delete-generic-password');
    expect(execFile.mock.calls[0][1]).toContain('-U');
  });
});
