import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type Notifier = {
  notify(title: string, body: string): Promise<void>;
};

export function createMacNotifier(): Notifier {
  return {
    async notify(title, body) {
      const script = `display notification ${quoteAppleScript(body)} with title ${quoteAppleScript(title)}`;
      await execFileAsync('osascript', ['-e', script]);
    }
  };
}

function quoteAppleScript(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
