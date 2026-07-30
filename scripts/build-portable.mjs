import { execFileSync } from 'node:child_process';
import { cpSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platformName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
const extension = process.platform === 'win32' ? '.exe' : '';
const releaseDir = join(root, 'release', platformName);
const seaDir = join(root, 'dist', 'sea');
const bundlePath = join(seaDir, 'server.cjs');
const blobPath = join(seaDir, 'sea-prep.blob');
const executablePath = join(releaseDir, `Bangumi-Watch-Planner${extension}`);
const postjectCli = join(root, 'node_modules', 'postject', 'dist', 'cli.js');

rmSync(releaseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
mkdirSync(releaseDir, { recursive: true });
mkdirSync(seaDir, { recursive: true });

await build({
  entryPoints: [join(root, 'src', 'server', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  banner: {
    js: "const { createRequire: __bwpCreateRequire } = require('node:module'); require = __bwpCreateRequire(process.cwd() + '/package.json');"
  },
  outfile: bundlePath
});

const seaConfigPath = join(seaDir, 'sea-config.json');
writeFileSync(seaConfigPath, JSON.stringify({
  main: bundlePath,
  output: blobPath,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false
}, null, 2));
run(process.execPath, ['--experimental-sea-config', seaConfigPath]);

if (process.platform === 'darwin') {
  run('lipo', ['-thin', process.arch, process.execPath, '-output', executablePath]);
} else {
  copyFileSync(process.execPath, executablePath);
}

const postjectArgs = [
  postjectCli,
  executablePath,
  'NODE_SEA_BLOB',
  blobPath,
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
];
if (process.platform === 'darwin') postjectArgs.push('--macho-segment-name', 'NODE_SEA');
run(process.execPath, postjectArgs);
if (process.platform === 'darwin') run('codesign', ['--sign', '-', '--force', executablePath]);

cpSync(join(root, 'dist', 'client'), join(releaseDir, 'dist', 'client'), { recursive: true });
cpSync(join(root, 'assets', 'readme'), join(releaseDir, 'assets', 'readme'), { recursive: true });
for (const file of ['package.json', 'package-lock.json', '.env.example', 'README.md']) {
  copyFileSync(join(root, file), join(releaseDir, file));
}
if (process.platform === 'win32') {
  cpSync(join(root, 'packaging', 'windows'), releaseDir, { recursive: true });
}

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is required to install portable runtime dependencies');
run(process.execPath, [npmCli, 'ci', '--omit=dev'], releaseDir);
console.log(`Portable package created at ${releaseDir}`);

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}
