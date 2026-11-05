import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : null;
if (!platform) throw new Error('Release archives support Windows and macOS');
const archive = resolve(`bangumi-watch-planner-v${version}-${platform}-${process.arch}.zip`);
const directory = resolve('release', platform);
if (platform === 'windows') {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Compress-Archive -Path (Join-Path $env:BWP_RELEASE_DIR "*") -DestinationPath $env:BWP_ARCHIVE_PATH -Force'], {
    stdio: 'inherit', env: { ...process.env, BWP_RELEASE_DIR: directory, BWP_ARCHIVE_PATH: archive }
  });
} else {
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', directory, archive], { stdio: 'inherit' });
}
console.log(archive);
