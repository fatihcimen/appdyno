#!/usr/bin/env node
// Appdyno.app and its disk image, from what `pnpm build` made. Everything lands in `.app-build`:
//   pnpm build && node scripts/build-app.mjs [--release]
//
// With no identity it signs ad hoc, and a person has to open it by hand once. These turn on the rest; each is a secret
// the person releasing holds, and none is ever looked up on this machine:
//   APPDYNO_SIGN_IDENTITY     the Developer ID Application identity below, and no other
//   APPDYNO_NOTARY_APPLE_ID, APPDYNO_NOTARY_PASSWORD, APPDYNO_NOTARY_TEAM     notarize and staple: a double click opens it
//   APPDYNO_NOTARY_PROFILE    the same from `notarytool store-credentials`, which keeps the password off the process list
//   APPDYNO_UPDATE_KEY        an Ed25519 private key, PEM: writes the signed appcast, and puts its public half in the app
//
// --release refuses a build that is not signed and notarized: a release opens with a double click, or it is no release.
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
import { buildGlassIcon, buildIcns, buildMenuGlyph } from './build-icons.mjs';
import { download } from './download.mjs';

/** The runtime, as nodejs.org publishes its digest: the long-term release in active support, which asks no newer macOS. */
const NODE = {
  version: 'v26.13.0',
  sha256: '6f5b3187d9df9fc007e881167905bc7d69ad26450ddc377c83d63256a2495b6e',
};
const MIN_MACOS = '13.5';
const NAME = 'Appdyno';
const WINDOW = 'Appdyno Window';

const IDENTITY = 'Developer ID Application: Fatih Cimen (BKXMF846AT)';

const { APPDYNO_SIGN_IDENTITY: identity, APPDYNO_UPDATE_KEY: updateKey } = process.env;
const { APPDYNO_NOTARY_PROFILE: profile } = process.env;
const [appleId, password, team] = ['APPLE_ID', 'PASSWORD', 'TEAM'].map(
  (k) => process.env[`APPDYNO_NOTARY_${k}`],
);
/** How notarytool logs in; none, and nothing is notarized. */
const credentials = profile
  ? ['--keychain-profile', profile]
  : appleId && password && team
    ? ['--apple-id', appleId, '--password', password, '--team-id', team]
    : [];
const notary = credentials.length > 0;

if (identity && identity !== IDENTITY) throw new Error(`only ${IDENTITY} signs this app`);
if (notary && !identity) throw new Error('notarizing needs APPDYNO_SIGN_IDENTITY');
if (process.argv.includes('--release') && !(identity && notary))
  throw new Error(
    'a release is signed and notarized: set APPDYNO_SIGN_IDENTITY, and APPDYNO_NOTARY_PROFILE or APPDYNO_NOTARY_APPLE_ID, _PASSWORD and _TEAM',
  );

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(repo, 'packages/appdyno');
const out = join(repo, '.app-build');
const app = join(out, `${NAME}.app`);
const contents = join(app, 'Contents');
const macos = join(contents, 'MacOS');
const resources = join(contents, 'Resources');
const helper = join(contents, 'Helpers', `${WINDOW}.app`);
const helpers = join(helper, 'Contents/MacOS');
const traceProcessor = join(helpers, 'trace_processor_shell');

if (!existsSync(join(pkg, 'agents/android/agent.apk')))
  throw new Error(
    'no Android agent: run ./gradlew :agent:assembleDebug in android/, then pnpm build',
  );

/** @type {unknown} */
const parsed = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
const manifest =
  /** @type {{ name: string; version: string; type: string; repository: { url: string } }} */ (
    parsed
  );
const { version } = manifest;
const repository = manifest.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
const image = `${NAME}-${version}-arm64.dmg`;

/**
 * @param {string} file
 * @param {...string} args
 */
const sh = (file, ...args) =>
  execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
/** @param {string} file */
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
/** @param {number} bytes */
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

/**
 * @param {string} path
 * @returns {number}
 */
function sizeOf(path) {
  if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) return statSync(path).size;
  return readdirSync(path).reduce((sum, f) => sum + sizeOf(join(path, f)), 0);
}

/** The pinned runtime, stripped: its symbols are a fifth of it, and nothing here reads them. */
async function runtime() {
  const name = `node-${NODE.version}-darwin-arm64`;
  const archive = join(out, 'cache', `${name}.tar.xz`);
  if (!existsSync(archive)) {
    mkdirSync(dirname(archive), { recursive: true });
    const url = `https://nodejs.org/dist/${NODE.version}/${name}.tar.xz`;
    await download(url, archive);
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

/**
 * Perfetto's trace processor, which Android's traces are read with, by the pin and digest a download of it is held to,
 * and its license. Beside the helpers, where the app's appdyno looks first; Perfetto's release has no NOTICE.
 */
async function traceProcessorBinary() {
  const { PERFETTO } = await import('@appdyno/driver-android');
  const asset = PERFETTO.assets['darwin-arm64'];
  if (!asset) throw new Error('no pinned Perfetto build for darwin-arm64');
  const folder = asset.name.replace(/\.zip$/, '');
  const archive = join(out, 'cache', `perfetto-${PERFETTO.version}-${asset.name}`);
  if (!existsSync(archive)) {
    mkdirSync(dirname(archive), { recursive: true });
    const url = `https://github.com/google/perfetto/releases/download/${PERFETTO.version}/${asset.name}`;
    await download(url, archive);
  }
  if (sha256(archive) !== asset.sha256) throw new Error(`${archive} is not the pinned release`);
  const unpacked = mkdtempSync(join(tmpdir(), 'appdyno-perfetto-'));
  sh(
    'unzip',
    '-q',
    archive,
    `${folder}/trace_processor_shell`,
    `${folder}/LICENSE`,
    '-d',
    unpacked,
  );
  copyFileSync(join(unpacked, folder, 'trace_processor_shell'), traceProcessor);
  chmodSync(traceProcessor, 0o755);
  copyFileSync(join(unpacked, folder, 'LICENSE'), join(resources, 'licenses/perfetto.txt'));
  rmSync(unpacked, { recursive: true, force: true });
}

/** The app's icon and menu glyph, and the same icon for the helper's Dock tile. */
function icon() {
  buildGlassIcon(resources, MIN_MACOS);
  buildIcns(join(resources, `${NAME}.icns`));
  buildMenuGlyph(resources);
  mkdirSync(join(helper, 'Contents/Resources'), { recursive: true });
  copyFileSync(join(resources, `${NAME}.icns`), join(helper, 'Contents/Resources', `${NAME}.icns`));
}

/**
 * No Dock icon of its own: a window's process takes one, and gives it up with the window.
 * @param {string} to
 * @param {string} identifier
 * @param {string} executable
 */
function infoPlist(to, identifier, executable) {
  const keys = {
    CFBundleDevelopmentRegion: 'en',
    CFBundleDisplayName: NAME,
    CFBundleExecutable: executable,
    CFBundleIconFile: NAME,
    CFBundleIconName: NAME,
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
  /** @param {string} f */
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
  copyFileSync(join(repo, 'mac/App/appdyno'), join(resources, 'bin/appdyno'));
  for (const tool of ['xcrun', 'xcodebuild']) {
    copyFileSync(join(repo, 'mac/App/no-tool'), join(resources, 'no-tools', tool));
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
    join(repo, 'mac/App/Menu.m'),
  );
  sh('strip', '-x', menu);
}

/**
 * @param {string} path
 * @param {...string} more
 */
function codesign(path, ...more) {
  const how = identity ? ['--sign', identity, '--timestamp'] : ['--sign', '-'];
  sh('codesign', '--force', '--options', 'runtime', ...how, ...more, path);
}

/** From the inside out, as each signature covers what is in it. */
function signAll() {
  const jit = ['--entitlements', join(repo, 'mac/App/entitlements.plist')];
  for (const f of readdirSync(helpers)) if (f !== 'appdyno-viewer') codesign(join(helpers, f));
  codesign(join(helpers, 'appdyno-viewer'));
  codesign(helper);
  codesign(join(macos, 'node'), ...jit);
  codesign(app);
  sh('codesign', '--verify', '--deep', '--strict', app);
}

/**
 * Apple's scan and its ticket, stapled on, so that a Mac with no network opens it too.
 * @param {string} path
 */
function notarize(path, upload = path) {
  sh('xcrun', 'notarytool', 'submit', upload, ...credentials, '--wait');
  sh('xcrun', 'stapler', 'staple', path);
  sh('xcrun', 'stapler', 'validate', path);
}

/** The app's own ticket, as a person drags it out of the disk image and leaves that behind. */
function notarizeApp() {
  const zip = join(out, `${NAME}.zip`);
  sh('ditto', '-c', '-k', '--keepParent', app, zip);
  notarize(app, zip);
  rmSync(zip);
  sh('spctl', '--assess', '--type', 'execute', app);
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
  if (identity) sh('codesign', '--sign', identity, '--timestamp', dmg);
  if (notary) notarize(dmg);
  return dmg;
}

/**
 * What a release says of itself, signed: the only thing an app believes before it downloads.
 * @param {string} dmg
 * @param {string} key
 */
function appcast(dmg, key) {
  const url = `${repository}/releases/download/v${version}/${image}`;
  const cast = { version, url, sha256: sha256(dmg), size: statSync(dmg).size };
  const text = `${JSON.stringify(cast, null, 2)}\n`;
  writeFileSync(join(out, 'appcast.json'), text);
  const signature = sign(null, Buffer.from(text), createPrivateKey(key));
  writeFileSync(join(out, 'appcast.json.sig'), `${signature.toString('base64')}\n`);
}

/** @param {string} dmg */
function cask(dmg) {
  const text = readFileSync(join(repo, 'mac/App/appdyno.rb'), 'utf8')
    .replaceAll('@VERSION@', version)
    .replaceAll('@SHA256@', sha256(dmg))
    .replaceAll('@REPOSITORY@', repository);
  writeFileSync(join(out, 'appdyno.rb'), text);
}

mkdirSync(out, { recursive: true });
// a build with no key has no appcast, and must not leave one of an earlier build
for (const file of ['appcast.json', 'appcast.json.sig']) rmSync(join(out, file), { force: true });
assemble();
await runtime();
await helperBinaries();
await traceProcessorBinary();
icon();
thePackage();
signAll();
if (notary) notarizeApp();
const dmg = diskImage();
if (updateKey) appcast(dmg, updateKey);
cask(dmg);

/** @type {[string, number][]} */
const parts = [
  ['Node runtime', sizeOf(join(macos, 'node'))],
  ['viewer and scanner', sizeOf(helpers) - sizeOf(traceProcessor)],
  ['trace processor', sizeOf(traceProcessor)],
  ['menu bar item', sizeOf(join(macos, NAME))],
  ['the package', sizeOf(join(resources, 'app'))],
];
for (const [what, bytes] of parts) console.log(`${what.padEnd(20)}${mb(bytes)}`);
console.log(`${'the app'.padEnd(20)}${mb(sizeOf(app))}`);
const signed = notary ? 'signed and notarized' : identity ? 'signed, NOT notarized' : 'ad hoc';
console.log(`${image.padEnd(32)}${mb(statSync(dmg).size)}, ${signed}`);
