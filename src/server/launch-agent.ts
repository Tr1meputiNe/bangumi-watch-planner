import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LAUNCH_AGENT_ID = 'com.local.bangumi-watch-planner';
export type RuntimePlatform = 'macOS' | 'Windows' | 'Linux' | 'Other';

export function getRuntimePlatform(platform: NodeJS.Platform = process.platform): RuntimePlatform {
  if (platform === 'darwin') return 'macOS';
  if (platform === 'win32') return 'Windows';
  if (platform === 'linux') return 'Linux';
  return 'Other';
}

export async function isBackgroundServiceInstalled(
  platform: NodeJS.Platform = process.platform,
  appData = process.env.APPDATA
): Promise<boolean> {
  const path = platform === 'darwin'
    ? join(homedir(), 'Library', 'LaunchAgents', `${LAUNCH_AGENT_ID}.plist`)
    : platform === 'win32' && appData
      ? join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Bangumi Watch Planner.lnk')
      : null;
  if (!path) return false;

  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
