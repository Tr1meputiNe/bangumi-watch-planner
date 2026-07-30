import { spawn } from 'node:child_process';

export type PowerShellRunner = (
  script: string,
  input?: string,
  env?: NodeJS.ProcessEnv
) => Promise<string>;

export const runPowerShell: PowerShellRunner = (script, input = '', env = {}) => new Promise((resolve, reject) => {
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
    {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    }
  );
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];

  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) {
      resolve(Buffer.concat(stdout).toString('utf8'));
      return;
    }
    reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `PowerShell exited with code ${code}`));
  });
  child.stdin.end(input);
});
