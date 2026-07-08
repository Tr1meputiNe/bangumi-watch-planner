import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LAUNCH_AGENT_ID = 'com.local.bangumi-watch-planner';

export async function isLaunchAgentInstalled(): Promise<boolean> {
  try {
    await access(join(homedir(), 'Library', 'LaunchAgents', `${LAUNCH_AGENT_ID}.plist`));
    return true;
  } catch {
    return false;
  }
}
