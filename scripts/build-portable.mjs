import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platformName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
const releaseDir = join(root, 'release', platformName);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script through npm run build:portable');
rmSync(releaseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
mkdirSync(releaseDir, { recursive: true });

let manifest;
if (process.platform === 'darwin') {
  // Bundled Node avoids SEA/native-addon injection differences between Mac CPUs.
  const appDir = join(releaseDir, 'Bangumi Watch Planner.app');
  const contents = join(appDir, 'Contents');
  const resources = join(contents, 'Resources');
  mkdirSync(join(contents, 'MacOS'), { recursive: true });
  mkdirSync(join(resources, 'runtime'), { recursive: true });
  copyFileSync(process.execPath, join(resources, 'runtime', 'node'));
  chmodSync(join(resources, 'runtime', 'node'), 0o755);
  cpSync(join(root, 'dist', 'server'), join(resources, 'dist', 'server'), { recursive: true });
  cpSync(join(root, 'dist', 'shared'), join(resources, 'dist', 'shared'), { recursive: true });
  cpSync(join(root, 'packaging', 'macos', 'Contents'), contents, { recursive: true });
  copyFileSync(join(root, 'packaging', 'macos', 'launcher.mjs'), join(resources, 'launcher.mjs'));
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  writeFileSync(join(contents, 'Info.plist'), infoPlist(version));
  chmodSync(join(contents, 'MacOS', 'Bangumi Watch Planner'), 0o755);
  copyRuntimeFiles(resources);
  installDependencies(resources);
  // Ad-hoc signing is not Developer ID signing or Apple notarization.
  run('codesign', ['--force', '--deep', '--sign', '-', appDir]);
  run('codesign', ['--verify', '--deep', '--strict', appDir]);
  manifest = { executable: relative(releaseDir, join(resources, 'runtime', 'node')), args: ['dist/server/index.js'], cwd: relative(releaseDir, resources) };
  writeFileSync(join(releaseDir, '使用说明.txt'), '将 Bangumi Watch Planner.app 移到“应用程序”或其他固定目录，双击打开。\n无需安装 Node.js 或使用终端。首次连接只需在页面粘贴 Bangumi 个人令牌。\n数据保存在 ~/Library/Application Support/BangumiWatchPlanner，替换应用不会删除数据。\n本包尚未经过 Apple 公证，首次打开可能需要按 macOS 的提示允许打开。\n');
} else {
  const executable = join(releaseDir, `Bangumi-Watch-Planner${process.platform === 'win32' ? '.exe' : ''}`);
  const seaDir = join(root, 'dist', 'sea');
  mkdirSync(seaDir, { recursive: true });
  const bundlePath = join(seaDir, 'server.cjs');
  const blobPath = join(seaDir, 'sea-prep.blob');
  await build({
    entryPoints: [join(root, 'src', 'server', 'index.ts')], bundle: true,
    platform: 'node', format: 'cjs', packages: 'external',
    banner: { js: "const { createRequire: __bwpCreateRequire } = require('node:module'); require = __bwpCreateRequire(process.cwd() + '/package.json');" },
    outfile: bundlePath
  });
  const config = join(seaDir, 'sea-config.json');
  writeFileSync(config, JSON.stringify({ main: bundlePath, output: blobPath, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }, null, 2));
  run(process.execPath, ['--experimental-sea-config', config]);
  copyFileSync(process.execPath, executable);
  run(process.execPath, [join(root, 'node_modules', 'postject', 'dist', 'cli.js'), executable, 'NODE_SEA_BLOB', blobPath, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2']);
  copyRuntimeFiles(releaseDir);
  if (process.platform === 'win32') cpSync(join(root, 'packaging', 'windows'), releaseDir, { recursive: true });
  installDependencies(releaseDir);
  manifest = { executable: relative(releaseDir, executable), args: [], cwd: '.' };
}
writeFileSync(join(releaseDir, 'portable-manifest.json'), JSON.stringify({ platform: process.platform, arch: process.arch, ...manifest }, null, 2));
console.log(`Portable package created at ${releaseDir}`);

function copyRuntimeFiles(destination) {
  cpSync(join(root, 'dist', 'client'), join(destination, 'dist', 'client'), { recursive: true });
  for (const file of ['package.json', 'package-lock.json', 'README.md']) copyFileSync(join(root, file), join(destination, file));
  const nodeLicense = [join(dirname(process.execPath), 'LICENSE'), join(dirname(dirname(process.execPath)), 'LICENSE')].find(existsSync);
  if (!nodeLicense) throw new Error('The bundled Node.js runtime must include its official LICENSE');
  copyFileSync(nodeLicense, join(destination, 'NODE-LICENSE.txt'));
  // Never copy .env.local, data/, logs/, or saved credentials into a release.
}
function installDependencies(cwd) {
  run(process.execPath, [npmCli, 'ci', '--omit=dev', '--no-audit', '--no-fund'], cwd);
}
function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}
function infoPlist(version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Bangumi Watch Planner</string>
<key>CFBundleDisplayName</key><string>Bangumi Watch Planner</string>
<key>CFBundleIdentifier</key><string>com.local.bangumi-watch-planner</string>
<key>CFBundleExecutable</key><string>Bangumi Watch Planner</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>LSMinimumSystemVersion</key><string>13.5</string>
<key>LSUIElement</key><true/>
</dict></plist>\n`;
}
