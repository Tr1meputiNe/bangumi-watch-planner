import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type KeychainTokenStore = {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(value: string): Promise<void>;
  deleteRefreshToken(): Promise<void>;
};

export function createKeychainTokenStore(service = 'bangumi-watch-planner', account = 'refresh-token'): KeychainTokenStore {
  return {
    async getRefreshToken() {
      try {
        const { stdout } = await execFileAsync('security', ['find-generic-password', '-s', service, '-a', account, '-w']);
        return stdout.trim() || null;
      } catch {
        return null;
      }
    },

    async setRefreshToken(value) {
      await this.deleteRefreshToken();
      await execFileAsync('security', ['add-generic-password', '-s', service, '-a', account, '-w', value]);
    },

    async deleteRefreshToken() {
      try {
        await execFileAsync('security', ['delete-generic-password', '-s', service, '-a', account]);
      } catch {
        // Deleting a non-existent Keychain item is a harmless no-op.
      }
    }
  };
}
