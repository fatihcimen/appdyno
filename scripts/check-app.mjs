#!/usr/bin/env node
// Appdyno.app as a stranger meets it: a home with nothing in it and a PATH with no Node and no developer tools. On a
// real such Mac `/usr/bin/xcrun` and its kin are stubs that raise the installer's dialog, so here each is a decoy that
// says it was reached, and `xcode-select` says what it says there. Windows stay behind, and this opens no web page.
//   pnpm build && node scripts/build-app.mjs && node scripts/check-app.mjs [--android <serial>] [--iphone <udid>] [--keep]
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CLIENTS, putOnPath, update } from '@appdyno/cli';

const { values: flags } = parseArgs({
  options: { android: { type: 'string' }, iphone: { type: 'string' }, keep: { type: 'boolean' } },
});
const phone = flags.android ?? flags.iphone;

/** What a Mac with no developer tools does not have, or has only as a stub that asks to install them. */
const ABSENT = [
  'ar',
  'as',
  'c++',
  'cc',
  'clang',
  'clang++',
  'cpp',
  'g++',
  'gcc',
  'git',
  'java',
  'ld',
  'lipo',
  'lldb',
  'make',
  'nm',
  'node',
  'npm',
  'npx',
  'otool',
  'pip3',
  'pnpm',
  'python3',
  'strip',
  'swift',
  'swiftc',
  'xcodebuild',
  'xcrun',
];

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const built = join(repo, '.app-build/Appdyno.app');
if (!existsSync(built)) throw new Error('no app: run scripts/build-app.mjs');

const temp = realpathSync(mkdtempSync(join(tmpdir(), 'appdyno-check-app-')));
const home = join(temp, 'home');
const tools = join(temp, 'path');
const decoys = join(temp, 'reached');
for (const d of [home, tools, join(temp, 'tmp')]) mkdirSync(d);
writeFileSync(decoys, '');

for (const name of readdirSync('/usr/bin'))
  if (!ABSENT.includes(name) && name !== 'xcode-select')
    symlinkSync(join('/usr/bin', name), join(tools, name));
for (const name of ABSENT) {
  writeFileSync(join(tools, name), `#!/bin/sh\necho "${name} $*" >> '${decoys}'\nexit 1\n`);
  chmodSync(join(tools, name), 0o755);
}
writeFileSync(join(tools, 'xcode-select'), '#!/bin/sh\nexit 2\n');
chmodSync(join(tools, 'xcode-select'), 0o755);

const env = {
  HOME: home,
  PATH: `${tools}:/bin:/usr/sbin:/sbin`,
  TMPDIR: join(temp, 'tmp'),
  USER: process.env.USER,
  LOGNAME: process.env.LOGNAME,
  // preferences follow this, not HOME
  CFFIXED_USER_HOME: home,
  // a stranger's Mac holds their own devices; this one may hold other people's
  APPDYNO_ALLOW_DEVICES: `^(${phone ?? 'none'})$`,
};
const app = join(temp, 'Applications/Appdyno.app');
mkdirSync(dirname(app));
cpSync(built, app, { recursive: true, verbatimSymlinks: true });
const command = join(app, 'Contents/Resources/bin/appdyno');
const menu = join(app, 'Contents/MacOS/Appdyno');

const say = (file, ...args) =>
  spawnSync(file, args, { env, encoding: 'utf8', input: '', timeout: 120_000 });

let failed = 0;
async function step(name, fn) {
  try {
    console.log(`ok   ${name}: ${await fn()}`);
  } catch (e) {
    failed = 1;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

/** The windows of the window server, read with no permission: an off-screen one is in the list too. */
const WINDOWS = `
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
int main(void) {
  NSArray *all = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionAll, kCGNullWindowID));
  for (NSDictionary *w in all) {
    NSString *owner = w[(id)kCGWindowOwnerName];
    if ([owner hasPrefix:@"appdyno-viewer"] || [owner isEqual:@"Appdyno"])
      printf("%d %s %.0fx%.0f %d\\n", [w[(id)kCGWindowOwnerPID] intValue], owner.UTF8String,
             [w[(id)kCGWindowBounds][@"Width"] doubleValue], [w[(id)kCGWindowBounds][@"Height"] doubleValue],
             [w[(id)kCGWindowNumber] intValue]);
  }
}`;
function windowLister() {
  const source = join(temp, 'windows.m');
  writeFileSync(source, WINDOWS);
  const bin = join(temp, 'windows');
  execFileSync('xcrun', [
    'clang',
    '-fobjc-arc',
    '-framework',
    'Foundation',
    '-framework',
    'CoreGraphics',
    '-o',
    bin,
    source,
  ]);
  return () => execFileSync(bin, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
}

const pidsOf = (pattern) =>
  spawnSync('/usr/bin/pgrep', ['-f', pattern], { encoding: 'utf8' })
    .stdout.trim()
    .split('\n')
    .filter(Boolean)
    .map(Number);

/** Everything under this copy of the app, so that no process of anyone else's is touched. */
async function stopAll() {
  for (const pid of pidsOf(temp)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // gone already
    }
  }
  await until('the app to end', () => pidsOf(temp).length === 0, 30_000);
}

async function until(what, ready, ms = 60_000) {
  const start = performance.now();
  for (;;) {
    const got = ready();
    if (got) return { got, ms: Math.round(performance.now() - start) };
    if (performance.now() - start > ms) throw new Error(`no ${what} in ${ms} ms`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const run = (file, args, options) =>
  new Promise((resolve, reject) => {
    const r = spawnSync(file, args, { ...options, encoding: 'utf8' });
    if (r.status === 0) resolve({ stdout: r.stdout, stderr: r.stderr });
    else reject(Object.assign(new Error(r.stderr), { stdout: r.stdout, stderr: r.stderr }));
  });

const versionOf = (bundle) =>
  JSON.parse(readFileSync(join(bundle, 'Contents/Resources/app/package.json'), 'utf8')).version;

/** The app at another version, signed as the build signs it, in a disk image as a release has it. */
function aRelease(from, version, name) {
  const stage = join(temp, name);
  mkdirSync(stage);
  const bundle = join(stage, 'Appdyno.app');
  cpSync(from, bundle, { recursive: true, verbatimSymlinks: true });
  const manifest = join(bundle, 'Contents/Resources/app/package.json');
  writeFileSync(
    manifest,
    readFileSync(manifest, 'utf8').replace(/"version": ".*"/, `"version": "${version}"`),
  );
  const plist = join(bundle, 'Contents/Info.plist');
  writeFileSync(
    plist,
    readFileSync(plist, 'utf8').replaceAll(
      /<string>\d+\.\d+\.\d+<\/string>/g,
      `<string>${version}</string>`,
    ),
  );
  execFileSync('codesign', ['--force', '--sign', '-', bundle], { stdio: 'ignore' });
  const dmg = join(temp, `${name}.dmg`);
  execFileSync('hdiutil', [
    'create',
    '-quiet',
    '-fs',
    'APFS',
    '-format',
    'UDZO',
    '-volname',
    'Appdyno',
    '-srcfolder',
    stage,
    dmg,
  ]);
  return dmg;
}

/** The two files of a release, and the image, by the addresses `update` asks for: no network. */
function aRegistry(dmg, version, key) {
  const repository = 'https://github.com/fatihcimen/appdyno';
  const url = `${repository}/releases/download/v${version}/image.dmg`;
  const bytes = readFileSync(dmg);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const text = Buffer.from(JSON.stringify({ version, url, sha256, size: bytes.length }));
  const cast = `${repository}/releases/latest/download/appcast.json`;
  const files = {
    [cast]: text,
    [`${cast}.sig`]: sign(null, text, key).toString('base64'),
    [url]: bytes,
  };
  return async (at) => {
    if (!files[at]) throw new Error(`nothing at ${at}`);
    return Buffer.from(files[at]);
  };
}

async function selfUpdate() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const old = join(temp, 'Updating/Appdyno.app');
  mkdirSync(dirname(old));
  cpSync(built, old, { recursive: true, verbatimSymlinks: true });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  writeFileSync(join(old, 'Contents/Resources/app/update-key.pem'), pem);
  execFileSync('codesign', ['--force', '--sign', '-', old], { stdio: 'ignore' });
  const was = versionOf(old);
  const root = join(old, 'Contents/Resources/app');
  const o = { root, run, tmp: join(temp, 'tmp'), out: () => undefined };
  const refused = async (get, words) => {
    const e = await update({ ...o, get }).then(
      () => undefined,
      (x) => x,
    );
    if (!e || !words.test(e.message)) throw new Error(`not refused: ${e?.message ?? 'it updated'}`);
    if (versionOf(old) !== was) throw new Error('the old app moved');
    return e.message;
  };
  await step('a release signed by another key is refused', () =>
    refused(
      aRegistry(
        aRelease(old, '9.0.0', 'other-key'),
        '9.0.0',
        generateKeyPairSync('ed25519').privateKey,
      ),
      /signature of the appcast/,
    ),
  );
  await step('an app changed after signing is refused, and the old one stays', () => {
    const dmg = aRelease(old, '9.0.1', 'tampered');
    const mount = join(temp, 'tampered-mount');
    mkdirSync(mount);
    const rw = join(temp, 'tampered-rw.dmg');
    execFileSync('hdiutil', ['convert', '-quiet', dmg, '-format', 'UDRW', '-o', rw]);
    execFileSync('hdiutil', ['attach', '-quiet', '-nobrowse', '-mountpoint', mount, rw]);
    writeFileSync(join(mount, 'Appdyno.app/Contents/Resources/app/dist/main.js'), '// changed\n');
    execFileSync('hdiutil', ['detach', '-quiet', mount]);
    return refused(aRegistry(rw, '9.0.1', privateKey), /fails its signature/);
  });
  await step(`${was} to 9.0.2, from a real disk image`, async () => {
    const get = aRegistry(aRelease(old, '9.0.2', 'good'), '9.0.2', privateKey);
    await update({ ...o, get });
    if (versionOf(old) !== '9.0.2') throw new Error(`at ${versionOf(old)}`);
    const beside = readdirSync(dirname(old));
    if (beside.join() !== 'Appdyno.app') throw new Error(`left beside it: ${beside}`);
    const r = say(join(old, 'Contents/Resources/bin/appdyno'), 'doctor');
    return r.stdout.split('\n')[0].replace(temp, '');
  });
}

/** A client's file, as `appdyno install` writes it from the app, and what becomes of it when the app moves. */
async function moved() {
  const file = join(home, CLIENTS.filter((c) => c.format === 'jsonc')[0].files[0]);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '{}\n');
  await step('MCP clients get the app, by the same install', () => {
    const r = say(command, 'install', '--yes');
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
    const text = readFileSync(file, 'utf8');
    if (!text.includes(command) || text.includes('npx')) throw new Error(text);
    return text.replace(/\s+/g, ' ').replaceAll(temp, '');
  });
  const linked = join(temp, 'on-path');
  await putOnPath({ home, command, run, link: linked, out: () => undefined });
  // a running hub would go on asking from a PATH that leads nowhere, as a person's would
  await stopAll();
  const from = join(temp, 'Elsewhere/Appdyno.app');
  mkdirSync(dirname(from));
  renameSync(app, from);
  await step('a moved app is fixed on the next open', async () => {
    const child = spawn(join(from, 'Contents/MacOS/Appdyno'), ['--behind'], {
      env,
      stdio: 'ignore',
    });
    const target = join(from, 'Contents/Resources/bin/appdyno');
    const { ms } = await until('a client that followed', () =>
      readFileSync(file, 'utf8').includes(target),
    );
    child.unref();
    await stopAll();
    const through = realpathSync(linked);
    if (through !== realpathSync(target)) throw new Error(`the link leads to ${through}`);
    return `the client's entry and the link on the PATH both lead to the new place, ${ms} ms after opening`;
  });
  renameSync(from, app);
}

try {
  await step('no Node and no tools on this PATH', () => {
    const r = say('/bin/sh', '-c', 'command -v node; command -v npm; xcode-select -p');
    if (r.status !== 2 || !r.stdout.includes(tools)) throw new Error(`said ${r.stdout}`);
    return 'node and npm here are decoys, xcode-select says none';
  });
  await step('the command line runs from the app', () => {
    const r = say(command, 'update', '--help');
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  });
  await step('doctor says it is the app, and fails on nothing a stranger lacks but adb', () => {
    const r = say(command, 'doctor');
    const lines = r.stdout.split('\n');
    if (!lines[0].includes('installed by the app')) throw new Error(lines[0]);
    const failing = lines.filter((l) => l.startsWith('FAIL')).filter((l) => !/ adb:/.test(l));
    if (failing.length) throw new Error(failing.join('; '));
    return `\n     ${lines.join('\n     ').replaceAll(temp, '')}`;
  });
  await step('the menu lists what a stranger has', () => {
    const r = say(menu, '--menu');
    if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr}`);
    if (!r.stdout.includes('in the menu bar: yes\nOpen Hub')) throw new Error(r.stdout);
    return r.stdout.trim().split('\n').join(' | ');
  });
  const windows = windowLister();
  const windowPids = () => new Set(windows().map((w) => w.split(' ')[0]));
  const carried = (pid) =>
    spawnSync('/bin/ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).stdout.includes(
      'Appdyno Window.app/Contents/MacOS/appdyno-viewer',
    );
  /** A window of a new process, of the viewer this app carries: a window that grew is not one. */
  const newWindow = (before) =>
    windows().find((w) => {
      const pid = w.split(' ')[0];
      return !before.has(pid) && !/ 0x0 /.test(w) && carried(pid);
    });
  await step("adb, from Google, with a person's word", () => {
    const no = say(command, 'tools', 'install', 'adb');
    if (no.status !== 2 || !/terms/.test(no.stderr)) throw new Error('it did not ask');
    const r = say(command, 'tools', 'install', 'adb', '--accept-license');
    if (r.status !== 0) throw new Error(r.stderr);
    const doctor = say(command, 'doctor')
      .stdout.split('\n')
      .find((l) => / adb:/.test(l));
    if (!doctor?.startsWith('ok')) throw new Error(doctor);
    return doctor.trim();
  });
  await step('the menu no longer asks for adb', () => {
    const r = say(menu, '--menu');
    if (r.stdout.includes('Get adb')) throw new Error(r.stdout);
    return r.stdout.trim().split('\n').join(' | ');
  });
  await step('the hub opens from the app, behind, and is the viewer it carries', async () => {
    const before = windowPids();
    const child = spawn(menu, ['--behind'], { env, stdio: 'ignore' });
    const { got, ms } = await until('hub window', () => newWindow(before));
    child.unref();
    // a moment for its first list of devices, then its picture, which a window off every screen still has
    await new Promise((r) => setTimeout(r, 3_000));
    const apps = spawnSync('/usr/bin/lsappinfo', ['list'], { encoding: 'utf8' }).stdout;
    const kind = new RegExp(`pid = ${child.pid} .*type="(\\w+)"`).exec(apps)?.[1];
    if (kind !== 'UIElement') throw new Error(`its type is ${kind}`);
    return `${got} after ${ms} ms, and no place in the Dock for the app itself`;
  });
  await step('a double click: LaunchServices opens the bundle', async () => {
    await stopAll();
    const before = windowPids();
    const asked = [
      `HOME=${home}`,
      `CFFIXED_USER_HOME=${home}`,
      `PATH=${env.PATH}`,
      `TMPDIR=${env.TMPDIR}`,
    ];
    asked.push(`APPDYNO_ALLOW_DEVICES=${env.APPDYNO_ALLOW_DEVICES}`);
    // what this account's launchd holds, which a stranger's has not
    asked.push(`ANDROID_HOME=${join(home, 'no-sdk')}`, `ANDROID_SDK_ROOT=${join(home, 'no-sdk')}`);
    const words = ['-g', '-n', ...asked.flatMap((e) => ['--env', e]), app, '--args', '--behind'];
    execFileSync('/usr/bin/open', words);
    const { got, ms } = await until('hub window', () => newWindow(before));
    return `${got} after ${ms} ms`;
  });
  if (phone)
    await step(`pictures of ${phone} in a window of the app, behind`, async () => {
      const before = windowPids();
      const video = join(temp, 'window.mp4');
      const log = join(temp, 'window.log');
      const written = openSync(log, 'w');
      const words = [
        'mirror',
        '--device',
        String(phone),
        '--behind',
        '--seconds',
        '20',
        '--record',
        video,
      ];
      const child = spawn(command, words, { env, stdio: ['ignore', written, written] });
      closeSync(written);
      const ended = new Promise((resolve) => child.once('exit', resolve));
      const { got, ms } = await until('device window', () => newWindow(before), 120_000);
      const code = await ended;
      const said = readFileSync(log, 'utf8');
      const frames = /recorded (\d+) frames/.exec(said)?.[1];
      if (code !== 0 || !Number(frames)) throw new Error(`exit ${code}: ${said.slice(-400)}`);
      return `${got} after ${ms} ms; ${frames} frames recorded, ${statSync(video).size} bytes of video`;
    });
  await selfUpdate();
  await moved();
  await step('nothing asked for developer tools', () => {
    const reached = readFileSync(decoys, 'utf8').trim();
    if (reached) throw new Error(`reached: ${reached.split('\n').slice(0, 5).join('; ')}`);
    return 'no decoy was reached';
  });
} finally {
  await stopAll();
  if (flags.keep) console.log(`kept ${temp}`);
  else rmSync(temp, { recursive: true, force: true });
}
console.log(failed ? 'FAILED' : 'passed');
process.exitCode = failed;
