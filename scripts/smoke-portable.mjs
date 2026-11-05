import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
const packageDir = resolve(process.argv[2] ?? `release/${platform}`);
const manifest = JSON.parse(await readFile(join(packageDir, 'portable-manifest.json'), 'utf8'));
const temporary = await mkdtemp(join(tmpdir(), 'bangumi-portable-smoke-'));
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((resolveClose, reject) => listener.close((error) => error ? reject(error) : resolveClose()));
const base = `http://127.0.0.1:${port}`;
const child = spawn(resolve(packageDir, manifest.executable), manifest.args, {
  cwd: resolve(packageDir, manifest.cwd), stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), APP_BASE_URL: base, DB_PATH: join(temporary, 'smoke.sqlite'), NOTIFICATIONS_ENABLED: 'false' }
});
let output = '';
let spawnError;
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });
child.on('error', (error) => { spawnError = error; });
try {
  let status;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode) throw new Error(`Packaged server exited before readiness: ${output}`);
    try {
      const response = await fetch(`${base}/api/auth/status`, { signal: AbortSignal.timeout(500) });
      if (response.ok && response.headers.get('x-bwp-app') === 'bangumi-watch-planner') { status = await response.json(); break; }
    } catch { /* Wait for the packaged process to bind its private test port. */ }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  if (!status || status.authenticated !== false) throw new Error(`Clean first launch failed: ${output}`);
  const html = await (await fetch(base, { signal: AbortSignal.timeout(2000) })).text();
  if (!html.includes('Bangumi Watch Planner')) throw new Error('Packaged web assets are missing');
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
  if (assets.length < 2) throw new Error('Packaged asset manifest is missing');
  for (const asset of assets) {
    const response = await fetch(`${base}${asset}`, { signal: AbortSignal.timeout(2000) });
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !(asset.endsWith('.css') ? contentType.includes('text/css') : /javascript/.test(contentType))) {
      throw new Error(`Packaged asset is unavailable: ${asset}`);
    }
    await response.arrayBuffer();
  }
  const backlog = await (await fetch(`${base}/api/backlog`, { signal: AbortSignal.timeout(2000) })).json();
  if (!Array.isArray(backlog.active) || backlog.active.length !== 0) throw new Error('Packaged SQLite initialization failed');
  console.log(JSON.stringify({ portable: packageDir, platform: manifest.platform, arch: manifest.arch, authenticated: status.authenticated, staticAssets: true, sqlite: true }));
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (child.pid && child.exitCode === null && !child.signalCode) {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit').catch(() => {}), new Promise((resolveDelay) => setTimeout(resolveDelay, 2000))]);
    if (child.exitCode === null && !child.signalCode) { child.kill('SIGKILL'); await once(child, 'exit'); }
  }
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
