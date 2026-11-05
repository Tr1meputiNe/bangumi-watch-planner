import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = 'http://127.0.0.1:3777';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function inspectService(url = baseUrl, request = fetch) {
  try {
    const response = await request(`${url}/api/auth/status`, { signal: AbortSignal.timeout(1500) });
    return response.ok && response.headers.get('x-bwp-app') === 'bangumi-watch-planner' ? 'ours' : 'other';
  } catch {
    return 'absent';
  }
}

export function matchesTrackedCommand(record, command) {
  return Number.isInteger(record?.pid) && record.pid > 1
    && typeof record.node === 'string' && typeof record.server === 'string'
    && command.trim() === `${record.node} ${record.server}`;
}

export async function launch() {
  const resources = dirname(fileURLToPath(import.meta.url));
  const userData = join(homedir(), 'Library', 'Application Support', 'BangumiWatchPlanner');
  const logs = join(userData, 'logs');
  const lock = join(userData, 'startup.lock');
  const pidFile = join(userData, 'server.json');
  const version = JSON.parse(readFileSync(join(resources, 'package.json'), 'utf8')).version;
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  const node = join(resources, 'runtime', 'node');
  const server = join(resources, 'dist', 'server', 'index.js');
  let locked = false;
  for (let attempt = 0; attempt < 60 && !locked; attempt += 1) {
    try { mkdirSync(lock); locked = true; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 90_000) rmSync(lock, { recursive: true, force: true });
        else await sleep(500);
      } catch (lockError) {
        if (lockError.code !== 'ENOENT') throw lockError;
      }
    }
  }
  if (!locked) throw new Error('另一次启动仍在进行，请稍后再打开。');
  try {
    let state = await inspectService();
    if (state === 'other') throw new Error('3777 端口已被其他服务占用，请先关闭占用服务。');
    if (state === 'ours' && existsSync(pidFile)) {
      let record;
      try { record = JSON.parse(readFileSync(pidFile, 'utf8')); } catch { /* Ignore a damaged stale record. */ }
      if (record && (record.version !== version || record.node !== node)) {
        let command = '';
        try { command = execFileSync('/bin/ps', ['-ww', '-p', String(record.pid), '-o', 'command='], { encoding: 'utf8' }); } catch { /* It may already have exited. */ }
        if (matchesTrackedCommand(record, command)) {
          process.kill(record.pid, 'SIGTERM');
          for (let attempt = 0; attempt < 30 && state === 'ours'; attempt += 1) {
            await sleep(200);
            state = await inspectService();
          }
          if (state === 'ours') throw new Error('旧版服务仍在退出，请稍后重试。');
        }
      }
    }
    if (state !== 'ours') {
      const stdout = openSync(join(logs, 'server.out.log'), 'a', 0o600);
      const stderr = openSync(join(logs, 'server.err.log'), 'a', 0o600);
      let startError;
      const child = spawn(node, [server], {
        cwd: resources, detached: true, stdio: ['ignore', stdout, stderr],
        env: { ...process.env, HOST: '127.0.0.1', PORT: '3777', APP_BASE_URL: baseUrl, DB_PATH: join(userData, 'bangumi-watch-planner.sqlite') }
      });
      closeSync(stdout); closeSync(stderr);
      child.on('error', (error) => { startError = error; });
      child.unref();
      if (child.pid) writeFileSync(pidFile, JSON.stringify({ pid: child.pid, node, server, version }), { mode: 0o600 });
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (startError) throw startError;
        state = await inspectService();
        if (state === 'ours') break;
        if (state === 'other') throw new Error('3777 端口已被其他服务占用。');
        if (child.exitCode !== null || child.signalCode) throw new Error('服务启动失败，请查看应用数据目录中的 logs/server.err.log。');
        await sleep(500);
      }
      if (state !== 'ours') throw new Error('服务未能启动，请查看应用数据目录中的 logs/server.err.log。');
    }
    execFileSync('/usr/bin/open', [baseUrl]);
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  launch().catch((error) => {
    const message = `Bangumi Watch Planner 启动失败：${error.message}`;
    console.error(message);
    try {
      execFileSync('/usr/bin/osascript', ['-e', 'on run argv', '-e', 'display alert "Bangumi Watch Planner" message (item 1 of argv)', '-e', 'end run', message]);
    } catch { /* Preserve console diagnostics if the system UI is unavailable. */ }
    process.exitCode = 1;
  });
}
