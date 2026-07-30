import { execFile } from 'node:child_process';
import { access, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { runPowerShell, type PowerShellRunner } from './powershell.js';

const execFileAsync = promisify(execFile);

export type RefreshTokenStore = {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(value: string): Promise<void>;
  deleteRefreshToken(): Promise<void>;
};

export function createTokenStore(options: {
  platform?: NodeJS.Platform;
  path?: string;
  powershell?: PowerShellRunner;
} = {}): RefreshTokenStore {
  const platform = options.platform ?? process.platform;
  if (platform === 'darwin') return createKeychainTokenStore();
  if (platform === 'win32') {
    return createWindowsTokenStore(
      options.path ?? defaultWindowsTokenPath(),
      options.powershell ?? runPowerShell
    );
  }
  return createFileTokenStore(options.path ?? resolve(process.cwd(), 'data', 'refresh-token'));
}

export function createKeychainTokenStore(
  service = 'bangumi-watch-planner',
  account = 'refresh-token'
): RefreshTokenStore {
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

export function createWindowsTokenStore(path: string, powershell: PowerShellRunner): RefreshTokenStore {
  const protectScript = `
$plain = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($plain)
$protected = [Security.Cryptography.ProtectedData]::Protect(
  $bytes,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[IO.File]::WriteAllBytes($env:BWP_TOKEN_PATH, $protected)
`;
  const unprotectScript = `
$protected = [IO.File]::ReadAllBytes($env:BWP_TOKEN_PATH)
$bytes = [Security.Cryptography.ProtectedData]::Unprotect(
  $protected,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
`;

  return {
    async getRefreshToken() {
      try {
        await access(path);
        return await powershell(unprotectScript, '', { BWP_TOKEN_PATH: path }) || null;
      } catch {
        return null;
      }
    },

    async setRefreshToken(value) {
      await mkdir(dirname(path), { recursive: true });
      await powershell(protectScript, value, { BWP_TOKEN_PATH: path });
    },

    async deleteRefreshToken() {
      await rm(path, { force: true });
    }
  };
}

function createFileTokenStore(path: string): RefreshTokenStore {
  return {
    async getRefreshToken() {
      try {
        return (await readFile(path, 'utf8')).trim() || null;
      } catch {
        return null;
      }
    },

    async setRefreshToken(value) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, value, { encoding: 'utf8', mode: 0o600 });
      await chmod(path, 0o600);
    },

    async deleteRefreshToken() {
      await rm(path, { force: true });
    }
  };
}

function defaultWindowsTokenPath(): string {
  return join(
    process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'),
    'BangumiWatchPlanner',
    'refresh-token.dat'
  );
}
