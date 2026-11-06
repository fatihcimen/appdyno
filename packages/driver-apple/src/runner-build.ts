import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DeviceError } from '@appdyno/protocol';
import { inCheckout, inPackage, reportProgress, stateDir } from '@appdyno/core';
import { brandSimulatorRunner } from './brand.js';
import { xcodeEnv } from './simctl.js';

const buildIds = new Map<string, { mtime: number; sha256: string }>();

/** The runner's products for a simulator or a phone: a development build, else built once from the packaged sources. */
export async function iosProducts(
  kind: 'simulator' | 'device',
  build = true,
): Promise<string | undefined> {
  const derived = kind === 'simulator' ? '.derived' : '.derived-device';
  const env =
    kind === 'simulator'
      ? process.env.APPDYNO_IOS_PRODUCTS
      : process.env.APPDYNO_IOS_DEVICE_PRODUCTS;
  const sdk = kind === 'simulator' ? 'iphonesimulator' : 'iphoneos';
  const has = (dir: string) =>
    existsSync(dir) && readdirSync(dir).some((f) => f.includes(sdk) && f.endsWith('.xctestrun'));
  const repo = inCheckout('ios');
  const found = [env, repo && join(repo, derived, 'Build/Products')].find(
    (d): d is string => !!d && has(d),
  );
  if (found) return found;
  const src = inPackage('ios');
  if (!src || !existsSync(join(src, 'Appdyno.xcodeproj'))) return undefined;
  const id = (await readFile(join(src, 'sources.sha256'), 'utf8').catch(() => 'unknown'))
    .trim()
    .slice(0, 16);
  const out = join(stateDir(), 'ios-build', id, kind);
  const products = join(out, 'Build/Products');
  if (has(products) || !build) return has(products) ? products : undefined;
  // one build per folder: a client that timed out and asks again joins it (xcodebuild would refuse a second)
  let building = builds.get(out);
  if (!building) {
    building = xcodebuildTelling(
      [
        'build-for-testing',
        '-project',
        join(src, 'Appdyno.xcodeproj'),
        '-scheme',
        'Runner',
        '-destination',
        kind === 'simulator' ? 'generic/platform=iOS Simulator' : 'generic/platform=iOS',
        '-derivedDataPath',
        out,
        ...(kind === 'device'
          ? ['CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=']
          : []),
      ],
      `building the iOS runner for the ${kind} once (a few minutes)`,
    ).finally(() => builds.delete(out));
    builds.set(out, building);
  }
  await building;
  return products;
}

const builds = new Map<string, Promise<void>>();

/** The phase a line of xcodebuild's output starts, if any. */
export function buildPhase(line: string): string | undefined {
  const target = /^=== BUILD TARGET (\S+)/.exec(line);
  if (target) return `target ${target[1]}`;
  // SwiftExplicitDependency…: the system's modules, the long part of a first build
  if (
    /^(SwiftExplicitDependency\w*|SwiftCompile|CompileSwift|SwiftEmitModule|CompileC)\b/.test(line)
  )
    return 'compiling';
  if (/^Ld\b/.test(line)) return 'linking';
  if (/^CodeSign\b/.test(line)) return 'signing';
  return undefined;
}

/** Runs xcodebuild, telling each phase once and where it stands every 10 s: someone waits on it for minutes. */
export function xcodebuildTelling(args: string[], what: string): Promise<void> {
  const started = Date.now();
  const phases = new Set<string>();
  let phase = 'starting';
  const tell = () => {
    const line = `${what}: ${phase}, ${Math.round((Date.now() - started) / 1000)} s`;
    process.stderr.write(`${line}\n`);
    reportProgress(line);
  };
  const last: string[] = [];
  const onLine = (line: string) => {
    if (line.trim()) last.push(line.trim());
    last.splice(0, last.length - 3);
    const p = buildPhase(line);
    if (p && !phases.has(p)) {
      phases.add(p);
      phase = p;
      tell();
    }
  };
  const child = spawn('xcodebuild', args, {
    env: xcodeEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 1_800_000,
  });
  createInterface({ input: child.stdout }).on('line', onLine);
  createInterface({ input: child.stderr }).on('line', onLine);
  tell();
  const beat = setInterval(tell, 10_000);
  return new Promise<void>((resolve, reject) => {
    const failed = (why: string) =>
      reject(
        new DeviceError(
          'UNSUPPORTED',
          `the iOS runner did not build: ${why.slice(0, 300)}`,
          'see appdyno doctor',
        ),
      );
    child.once('error', (e) => failed(e.message));
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else failed(signal ? `xcodebuild stopped by ${signal}` : last.join(' '));
    });
  }).finally(() => clearInterval(beat));
}

/** Removes the runner builds of other packaged sources than the installed ones; how many were removed. */
export async function pruneIosBuilds(): Promise<number> {
  const sources = inPackage('ios', 'sources.sha256');
  const id = sources ? (await readFile(sources, 'utf8')).trim().slice(0, 16) : '';
  const root = join(stateDir(), 'ios-build');
  if (!id || !existsSync(root)) return 0;
  let n = 0;
  for (const d of readdirSync(root))
    if (d !== id && /^[0-9a-f]{16}$/.test(d)) {
      await rm(join(root, d), { recursive: true, force: true });
      n++;
    }
  return n;
}

/** The built runner (xctestrun file and products) and an id of its build. */
export async function runnerBuild(): Promise<{ xctestrun: string; sha256: string }> {
  const dir = await iosProducts('simulator');
  const file = dir && readdirSync(dir).find((f) => /iphonesimulator.*\.xctestrun$/.test(f));
  if (!dir || !file)
    throw new DeviceError(
      'UNSUPPORTED',
      'the iOS runner is not built',
      "build it: (cd ios && xcodebuild build-for-testing -project Appdyno.xcodeproj -scheme Runner -destination 'generic/platform=iOS Simulator' -derivedDataPath .derived)",
    );
  // the home screen shows the runner as appdyno (once per build; the test binary is not touched)
  await brandSimulatorRunner(join(dir, 'Debug-iphonesimulator/Runner-Runner.app'));
  const binary = join(dir, 'Debug-iphonesimulator/Runner-Runner.app/PlugIns/Runner.xctest/Runner');
  const hashed = existsSync(binary) ? binary : join(dir, file);
  const mtime = statSync(hashed).mtimeMs;
  // the build id is read once per build (hashing the binary on every connect costs time)
  if (buildIds.get(hashed)?.mtime !== mtime)
    buildIds.set(hashed, {
      mtime,
      sha256: createHash('sha256')
        .update(await readFile(hashed))
        .digest('hex'),
    });
  return { xctestrun: join(dir, file), sha256: buildIds.get(hashed)!.sha256 };
}
