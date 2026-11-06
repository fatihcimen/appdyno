#!/usr/bin/env node
// Appdyno.app and its disk image, from what `pnpm build` made. Everything lands in `.app-build`:
//   pnpm build && node scripts/build-app.mjs
//
// With no identity it signs ad hoc, and a person is warned on first open. These turn on the rest; each is a secret
// the person releasing holds, and none is ever looked up on this machine:
//   APPDYNO_SIGN_IDENTITY     a Developer ID Application identity: signs for release, and then needs
//   APPDYNO_NOTARY_APPLE_ID, APPDYNO_NOTARY_PASSWORD, APPDYNO_NOTARY_TEAM     which notarize it
//   APPDYNO_UPDATE_KEY        an Ed25519 private key, PEM: writes the signed appcast, and puts its public half in the app
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIcns, buildMenuGlyph } from './build-icons.mjs';

/** The runtime, as nodejs.org publishes its digest. The smallest long-term release with years of fixes ahead. */
const NODE = {
  version: 'v24.22.2',
  sha256: '1f5ac075be50bed4780ea3be19a007fda95ea4d527d28d76d0b91de47d915115',
};
const MIN_MACOS = '13.5';
const NAME = 'Appdyno';
const WINDOW = 'Appdyno Window';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(repo, 'packages/appdyno');
const out = join(repo, '.app-build');
const app = join(out, `${NAME}.app`);
const contents = join(app, 'Contents');
const macos = join(contents, 'MacOS');
const resources = join(contents, 'Resources');
const helper = join(contents, 'Helpers', `${WINDOW}.app`);
const helpers = join(helper, 'Contents/MacOS');

const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
const { version } = manifest;
const repository = manifest.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
const image = `${NAME}-${version}-arm64.dmg`;

const { APPDYNO_SIGN_IDENTITY: identity, APPDYNO_UPDATE_KEY: updateKey } = process.env;
const notary = ['APPLE_ID', 'PASSWORD', 'TEAM'].map((k) => process.env[`APPDYNO_NOTARY_${k}`]);
if (identity && !notary.every(Boolean))
  throw new Error('a release identity needs APPDYNO_NOTARY_APPLE_ID, _PASSWORD and _TEAM');

const sh = (file, ...args) =>
  execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

function sizeOf(path) {
  if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) return statSync(path).size;
  return readdirSync(path).reduce((sum, f) => sum + sizeOf(join(path, f)), 0);
}

/** The pinned runtime, stripped: its symbols are a fifth of it, and nothing here reads them. */
function runtime() {
  const name = `node-${NODE.version}-darwin-arm64`;
  const archive = join(out, 'cache', `${name}.tar.xz`);
  if (!existsSync(archive)) {
    mkdirSync(dirname(archive), { recursive: true });
    const url = `https://nodejs.org/dist/${NODE.version}/${name}.tar.xz`;
    sh('curl', '-sSfL', '--retry', '3', '-o', archive, url);
  }
  if (sha256(archive) !== NODE.sha256) throw new Error(`${archive} is not the pinned runtime`);
  const unpacked = mkdtempSync(join(tmpdir(), 'appdyno-node-'));
  sh('tar', '-xJf', archive, '-C', unpacked, `${name}/bin/node`, `${name}/LICENSE`);
  copyFileSync(join(unpacked, name, 'bin/node'), join(macos, 'node'));
  copyFileSync(join(unpacked, name, 'LICENSE'), join(resources, 'licenses/node.txt'));
  rmSync(unpacked, { recursive: true, force: true });
  sh('strip', '-x', join(macos, 'node'));
}

/** The helpers, by the code that builds them for the npm package, for the oldest Mac this app runs on. */
async function helperBinaries() {
  process.env.APPDYNO_NATIVE_DIR = join(out, 'cache/native');
  process.env.MACOSX_DEPLOYMENT_TARGET = MIN_MACOS;
  rmSync(process.env.APPDYNO_NATIVE_DIR, { recursive: true, force: true });
  const { textScanner, viewerBinary } = await import('@appdyno/core');
  for (const built of [await viewerBinary(), await textScanner()]) {
    const to = join(helpers, basename(built));
    copyFileSync(built, to);
    sh('strip', '-x', to);
  }
}

/** The app's icon and menu glyph, and the same icon for the helper's Dock tile. */
function icon() {
  buildIcns(join(resources, `${NAME}.icns`));
  buildMenuGlyph(resources);
  mkdirSync(join(helper, 'Contents/Resources'), { recursive: true });
  copyFileSync(join(resources, `${NAME}.icns`), join(helper, 'Contents/Resources', `${NAME}.icns`));
}

/** No Dock icon of its own: a window's process takes one, and gives it up with the window. */
function infoPlist(to, identifier, executable) {
  const keys = {
    CFBundleDevelopmentRegion: 'en',
    CFBundleDisplayName: NAME,
    CFBundleExecutable: executable,
    CFBundleIconFile: NAME,
    CFBundleIdentifier: identifier,
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: NAME,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
    LSApplicationCategoryType: 'public.app-category.developer-tools',
    LSMinimumSystemVersion: MIN_MACOS,
  };
  const entries = Object.entries(keys).map(
    ([k, v]) => `  <key>${k}</key>\n  <string>${v}</string>`,
  );
  writeFileSync(
    join(to, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries.join('\n')}
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`,
  );
}

/** What runs a package: nothing of its types or its library, which no Mac app reads. */
function thePackage() {
  const to = join(resources, 'app');
  const needed = (f) =>
    !f.endsWith('.d.ts') && !f.endsWith('dist/types') && !f.endsWith('dist/index.js');
  cpSync(join(pkg, 'dist'), join(to, 'dist'), { recursive: true, filter: needed });
  cpSync(join(pkg, 'agents'), join(to, 'agents'), { recursive: true });
  const { name, type } = manifest;
  const kept = { name, version, type, repository: manifest.repository };
  writeFileSync(join(to, 'package.json'), `${JSON.stringify(kept, null, 2)}\n`);
  if (updateKey) {
    const key = createPublicKey(createPrivateKey(updateKey));
    writeFileSync(join(to, 'update-key.pem'), key.export({ type: 'spki', format: 'pem' }));
  }
}

function assemble() {
  rmSync(app, { recursive: true, force: true });
  for (const d of [macos, helpers, join(resources, 'bin'), join(resources, 'no-tools')])
    mkdirSync(d, { recursive: true });
  mkdirSync(join(resources, 'licenses'));
  infoPlist(contents, 'dev.appdyno.app', NAME);
  infoPlist(join(helper, 'Contents'), 'dev.appdyno.window', 'appdyno-viewer');
  copyFileSync(join(repo, 'THIRD_PARTY_NOTICES'), join(resources, 'licenses/third-party.txt'));
  copyFileSync(join(repo, 'app/appdyno'), join(resources, 'bin/appdyno'));
  for (const tool of ['xcrun', 'xcodebuild']) {
    copyFileSync(join(repo, 'app/no-tool'), join(resources, 'no-tools', tool));
    chmodSync(join(resources, 'no-tools', tool), 0o755);
  }
  const sdk = `-mmacosx-version-min=${MIN_MACOS}`;
  const menu = join(macos, NAME);
  sh(
    'xcrun',
    'clang',
    '-fobjc-arc',
    '-O2',
    sdk,
    '-framework',
    'AppKit',
    '-o',
    menu,
    join(repo, 'app/Menu.m'),
  );
  sh('strip', '-x', menu);
}

function codesign(path, ...more) {
  const how = identity ? ['--sign', identity, '--timestamp'] : ['--sign', '-'];
  sh('codesign', '--force', '--options', 'runtime', ...how, ...more, path);
}

/** From the inside out, as each signature covers what is in it. */
function signAll() {
  const jit = ['--entitlements', join(repo, 'app/entitlements.plist')];
  for (const f of readdirSync(helpers)) if (f !== 'appdyno-viewer') codesign(join(helpers, f));
  codesign(join(helpers, 'appdyno-viewer'));
  codesign(helper);
  codesign(join(macos, 'node'), ...jit);
  codesign(app);
  sh('codesign', '--verify', '--deep', '--strict', app);
}

function diskImage() {
  const stage = mkdtempSync(join(tmpdir(), 'appdyno-dmg-'));
  sh('ditto', app, join(stage, `${NAME}.app`));
  symlinkSync('/Applications', join(stage, 'Applications'));
  const dmg = join(out, image);
  rmSync(dmg, { force: true });
  sh(
    'hdiutil',
    'create',
    '-quiet',
    '-fs',
    'APFS',
    '-format',
    'ULMO',
    '-volname',
    NAME,
    '-srcfolder',
    stage,
    dmg,
  );
  rmSync(stage, { recursive: true, force: true });
  if (identity) {
    sh('codesign', '--sign', identity, '--timestamp', dmg);
    const [appleId, password, team] = notary;
    const who = ['--apple-id', appleId, '--password', password, '--team-id', team];
    sh('xcrun', 'notarytool', 'submit', dmg, ...who, '--wait');
    sh('xcrun', 'stapler', 'staple', dmg);
  }
  return dmg;
}

/** What a release says of itself, signed: the only thing an app believes before it downloads. */
function appcast(dmg, key) {
  const url = `${repository}/releases/download/v${version}/${image}`;
  const cast = { version, url, sha256: sha256(dmg), size: statSync(dmg).size };
  const text = `${JSON.stringify(cast, null, 2)}\n`;
  writeFileSync(join(out, 'appcast.json'), text);
  const signature = sign(null, Buffer.from(text), createPrivateKey(key));
  writeFileSync(join(out, 'appcast.json.sig'), `${signature.toString('base64')}\n`);
}

function cask(dmg) {
  const text = readFileSync(join(repo, 'app/appdyno.rb'), 'utf8')
    .replaceAll('@VERSION@', version)
    .replaceAll('@SHA256@', sha256(dmg))
    .replaceAll('@REPOSITORY@', repository);
  writeFileSync(join(out, 'appdyno.rb'), text);
}

mkdirSync(out, { recursive: true });
// a build with no key has no appcast, and must not leave one of an earlier build
for (const file of ['appcast.json', 'appcast.json.sig']) rmSync(join(out, file), { force: true });
assemble();
runtime();
await helperBinaries();
icon();
thePackage();
signAll();
const dmg = diskImage();
if (updateKey) appcast(dmg, updateKey);
cask(dmg);

const parts = [
  ['Node runtime', join(macos, 'node')],
  ['viewer and scanner', helpers],
  ['menu bar item', join(macos, NAME)],
  ['the package', join(resources, 'app')],
];
for (const [what, path] of parts) console.log(`${what.padEnd(20)}${mb(sizeOf(path))}`);
console.log(`${'the app'.padEnd(20)}${mb(sizeOf(app))}`);
console.log(
  `${image.padEnd(32)}${mb(statSync(dmg).size)}, signed ${identity ? 'for release' : 'ad hoc'}`,
);
