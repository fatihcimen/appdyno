import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DeviceError } from '@appdyno/protocol';
import { inCheckout, inPackage, reportProgress, run, stateDir, must } from '@appdyno/core';
import { brandSimulatorRunner } from './brand.js';
import { xcodeEnv } from './simctl.js';

const buildIds = new Map<string, { mtime: number; sha256: string }>();

type Kind = 'simulator' | 'device';
const DERIVED = { simulator: '.derived', device: '.derived-device' } as const;

/** The line that builds a checkout's runner, run from its root. */
export const BUILD_LINE = {
  simulator:
    "(cd ios && xcodebuild build-for-testing -project Appdyno.xcodeproj -scheme Runner -destination 'generic/platform=iOS Simulator' -derivedDataPath .derived)",
  device:
    "(cd ios && xcodebuild build-for-testing -project Appdyno.xcodeproj -scheme Runner -destination 'generic/platform=iOS' -derivedDataPath .derived-device CODE_SIGNING_ALLOWED=NO)",
} as const;

/** What a build of the runner reads in a checkout's ios folder. */
const SOURCES = ['Runner', 'RunnerCore', 'Fixture', 'Appdyno.xcodeproj/project.pbxproj'];

/** The last change under a path, a folder's own (a file gone) too; dot folders, SwiftPM's .build, aside. */
function lastChange(path: string): number {
  const s = statSync(path, { throwIfNoEntry: false });
  if (!s?.isDirectory()) return s?.mtimeMs ?? 0;
  const inside = readdirSync(path).filter((f) => !f.startsWith('.'));
  return Math.max(s.mtimeMs, ...inside.map((f) => lastChange(join(path, f))));
}

/**
 * Where the products are a checkout's own and were built before its runner's sources last changed: the line that
 * builds them again. A packaged build is keyed by its sources' hash instead.
 */
export function checkoutBehind(
  kind: Kind,
  products: string,
  ios = inCheckout('ios'),
): string | undefined {
  if (!ios || products !== join(ios, DERIVED[kind], 'Build/Products')) return undefined;
  // xcodebuild writes the xctestrun at every build, one that changes nothing too
  const built = Math.max(
    0,
    ...readdirSync(products)
      .filter((f) => f.endsWith('.xctestrun'))
      .map((f) => statSync(join(products, f)).mtimeMs),
  );
  return Math.max(...SOURCES.map((p) => lastChange(join(ios, p)))) > built
    ? BUILD_LINE[kind]
    : undefined;
}

/** The runner's products for a simulator or a phone: a development build, else built once from the packaged sources. */
export async function iosProducts(kind: Kind, build = true): Promise<string | undefined> {
  const env =
    kind === 'simulator'
      ? process.env.APPDYNO_IOS_PRODUCTS
      : process.env.APPDYNO_IOS_DEVICE_PRODUCTS;
  const sdk = kind === 'simulator' ? 'iphonesimulator' : 'iphoneos';
  const has = (dir: string) =>
    existsSync(dir) && readdirSync(dir).some((f) => f.includes(sdk) && f.endsWith('.xctestrun'));
  const repo = inCheckout('ios');
  const found = [env, repo && join(repo, DERIVED[kind], 'Build/Products')].find(
    (d): d is string => !!d && has(d),
  );
  if (found) {
    // said, not refused nor built here: a person decides when to build
    const behind = checkoutBehind(kind, found, repo);
    if (behind) reportProgress(`this checkout's iOS runner is older than ios/: ${behind}`);
    return found;
  }
  const src = inPackage('ios');
  if (!src || !existsSync(join(src, 'Appdyno.xcodeproj'))) return undefined;
  const id = await sourcesId(src);
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
    )
      // what other sources built goes once this one is there; a build that stays is no failure of this one
      .then(() => pruneIosBuilds(id).catch(() => 0))
      .then(() => undefined)
      .finally(() => builds.delete(out));
    builds.set(out, building);
  }
  await building;
  return products;
}

/** What a build in the state folder is kept by: the first 16 of its sources' sha256, which each change of them moves. */
async function sourcesId(src = inPackage('ios')) {
  const sha = src ? await readFile(join(src, 'sources.sha256'), 'utf8').catch(() => '') : '';
  return sha.trim().slice(0, 16) || 'unknown';
}

const builds = new Map<string, Promise<void>>();

/** The phase a line of xcodebuild's output starts, if any. */
export function buildPhase(line: string): string | undefined {
  const target = /^=== BUILD TARGET (\S+)/.exec(line);
  if (target) return `target ${must(target[1], 'a target')}`;
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

/**
 * Removes the runner builds in the state folder of other sources than `keep`, the ones in use here, after each build
 * and by `ios build`, in a package and in a checkout alike, where each change of the runner's sources builds anew. A
 * build a process names on its command line, as xcodebuild runs a runner from one or builds it, stays, and so does
 * all of it where the processes cannot be read. How many were removed.
 */
export async function pruneIosBuilds(keep?: string): Promise<number> {
  const root = join(stateDir(), 'ios-build');
  if (!existsSync(root)) return 0;
  const kept = keep ?? (await sourcesId());
  const { stdout } = await run('ps', ['-Axww', '-o', 'command='], {
    maxBuffer: 64 * 1024 * 1024,
  }).catch(() => ({ stdout: undefined }));
  if (stdout === undefined) return 0;
  let n = 0;
  for (const d of readdirSync(root))
    if (d !== kept && /^[0-9a-f]{16}$/.test(d) && !stdout.includes(join(root, d, '/'))) {
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
      `build it: ${BUILD_LINE.simulator}`,
    );
  // the home screen shows the runner as appdyno (once per build; the test binary is not touched)
  await brandSimulatorRunner(join(dir, 'Debug-iphonesimulator/Runner-Runner.app'));
  const binary = join(dir, 'Debug-iphonesimulator/Runner-Runner.app/PlugIns/Runner.xctest/Runner');
  const hashed = existsSync(binary) ? binary : join(dir, file);
  const mtime = statSync(hashed).mtimeMs;
  // the build id is read once per build (hashing the binary on every connect costs time)
  let known = buildIds.get(hashed);
  if (known?.mtime !== mtime) {
    known = {
      mtime,
      sha256: createHash('sha256')
        .update(await readFile(hashed))
        .digest('hex'),
    };
    buildIds.set(hashed, known);
  }
  return { xctestrun: join(dir, file), sha256: known.sha256 };
}
