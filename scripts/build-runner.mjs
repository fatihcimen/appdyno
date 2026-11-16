#!/usr/bin/env node
// The simulator runner a release attaches, so a first use fetches it and builds none: built from the sources the
// package carries, zipped into `.app-build` under the id of those sources, and named with its sha256 in
// `prebuilt.json` beside each packaged copy of them. The checksum so travels in the package, and the file by the
// release. Run before anything that packs the package:
//   pnpm build && node scripts/build-runner.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATIVE_PARTS } from '@appdyno/core';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcesIn = (/** @type {string} */ pkg) =>
  join(repo, 'packages', pkg, 'agents', NATIVE_PARTS.ios.packaged);
// the driver's copy, which nothing publishes: whatever a build leaves beside a project stays out of the package
const src = sourcesIn('driver-apple');
const id = readFileSync(join(src, 'sources.sha256'), 'utf8').trim().slice(0, 16);
/** @type {unknown} */
const manifest = JSON.parse(readFileSync(join(repo, 'packages/appdyno/package.json'), 'utf8'));
const { version } = /** @type {{ version: string }} */ (manifest);
const xcode = /^Xcode (\S+)/.exec(execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' }));
if (!xcode?.[1]) throw new Error('xcodebuild says no version');

const derived = mkdtempSync(join(tmpdir(), 'appdyno-runner-'));
try {
  execFileSync(
    'xcodebuild',
    [
      'build-for-testing',
      '-quiet',
      '-project',
      join(src, 'Appdyno.xcodeproj'),
      '-scheme',
      'Runner',
      '-destination',
      'generic/platform=iOS Simulator',
      '-derivedDataPath',
      derived,
      // a Mac with Apple silicon runs no other: half the binaries
      'ARCHS=arm64',
      'ONLY_ACTIVE_ARCH=NO',
    ],
    { stdio: 'inherit' },
  );
  const products = join(derived, 'Build/Products');
  const built = join(products, 'Debug-iphonesimulator');
  if (!readdirSync(products).some((f) => /iphonesimulator.*\.xctestrun$/.test(f)))
    throw new Error(`no xctestrun in ${products}`);
  // XCTest's own frameworks, 18 of 21 MB: a simulator loads them from the Xcode that runs the runner, by the paths the
  // xctestrun names, which is also what lets another Xcode run it. The app is signed again where it is first used
  rmSync(join(built, 'Runner-Runner.app/Frameworks'), { recursive: true });
  for (const f of readdirSync(built))
    if (f.endsWith('.swiftmodule')) rmSync(join(built, f), { recursive: true });

  const file = `appdyno-runner-simulator-${id}.zip`;
  const out = join(repo, '.app-build');
  mkdirSync(out, { recursive: true });
  rmSync(join(out, file), { force: true });
  execFileSync('zip', ['-qryX9', join(out, file), '.'], { cwd: products });
  const data = readFileSync(join(out, file));
  const prebuilt = {
    version,
    id,
    file,
    sha256: createHash('sha256').update(data).digest('hex'),
    bytes: data.length,
    xcode: xcode[1],
  };
  for (const pkg of ['driver-apple', 'appdyno']) {
    if (!existsSync(sourcesIn(pkg))) throw new Error(`${sourcesIn(pkg)} is missing: pnpm build`);
    writeFileSync(join(sourcesIn(pkg), 'prebuilt.json'), `${JSON.stringify(prebuilt, null, 2)}\n`);
  }
  console.log(`${file} ${(data.length / 1e6).toFixed(2)} MB, Xcode ${prebuilt.xcode}`);
  console.log(`sha256 ${prebuilt.sha256}`);
} finally {
  rmSync(derived, { recursive: true, force: true });
}
