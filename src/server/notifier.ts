import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runPowerShell, type PowerShellRunner } from './powershell.js';

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

export function createSystemNotifier(
  platform: NodeJS.Platform = process.platform,
  powershell: PowerShellRunner = runPowerShell
): Notifier {
  if (platform === 'darwin') return createMacNotifier();
  if (platform === 'win32') return createWindowsNotifier(powershell);
  return {
    async notify(title, body) {
      console.info(`[${title}] ${body}`);
    }
  };
}

export function createWindowsNotifier(powershell: PowerShellRunner): Notifier {
  const script = `
$title = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:BWP_NOTIFICATION_TITLE))
$body = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:BWP_NOTIFICATION_BODY))
$safeTitle = [Security.SecurityElement]::Escape($title)
$safeBody = [Security.SecurityElement]::Escape($body)
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template=\`"ToastGeneric\`"><text>$safeTitle</text><text>$safeBody</text></binding></visual></toast>")
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("PowerShell").Show($toast)
`;

  return {
    async notify(title, body) {
      await powershell(script, '', {
        BWP_NOTIFICATION_TITLE: Buffer.from(title).toString('base64'),
        BWP_NOTIFICATION_BODY: Buffer.from(body).toString('base64')
      });
    }
  };
}

function quoteAppleScript(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
