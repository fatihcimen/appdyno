import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Check } from './device.js';
import { NEEDS, NeedError } from './mirror/need.js';
import { run } from './run.js';

/** How long a first compile may take on a loaded Mac: 25 s was measured at load 270. */
const COMPILE_MS = 300_000;

/** Each native part: where it is in the repository, and under `agents` in the published package. The one list of both. */
export const NATIVE_PARTS = {
  viewer: { repo: 'mirror/Viewer', packaged: 'mirror-src' },
  mac: { repo: 'mac', packaged: 'mac-src' },
  ios: { repo: 'ios', packaged: 'ios-src' },
  agent: { repo: 'android/agent/build/outputs/apk/debug', packaged: 'android' },
} as const;
type NativePart = keyof typeof NATIVE_PARTS;

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');

/**
 * A part in the repository, when this runs from a checkout. An installed package sits at the same depth, so a folder
 * that merely is at that place must not count: a project has an `ios` of its own.
 */
export function inCheckout(part: NativePart, file = ''): string | undefined {
  const isCheckout = existsSync(join(root, NATIVE_PARTS.ios.repo, 'Appdyno.xcodeproj'));
  return isCheckout ? join(root, NATIVE_PARTS[part].repo, file) : undefined;
}

/** A part in the published package, or in a checkout where a driver's build left its own. */
export const inPackage = (part: NativePart, file = ''): string | undefined =>
  ['..', '../../driver-android', '../../driver-apple']
    .map((pkg) => join(here, pkg, 'agents', NATIVE_PARTS[part].packaged, file))
    .find((p) => existsSync(p));

/** A file of a native part: a checkout's, which is the newest, or else the package's. */
export function nativeFile(part: NativePart, file: string): string {
  const repo = inCheckout(part, file);
  const found = repo && existsSync(repo) ? repo : inPackage(part, file);
  if (!found) throw new Error(`${file} is missing from this install`);
  return found;
}

export type NativeBuild = {
  name: string;
  /** Compiled, in this order. */
  sources: string[];
  /** Not compiled, but a change to one means a new build. */
  headers?: string[];
  /** `xcrun`'s words before the output and the sources. */
  flags: string[];
  env?: NodeJS.ProcessEnv;
};

/**
 * A native program compiled once per source and flags, on first use, by the Mac's own compiler. A name
 * that exists is whole: it appears by a rename. What the app ships is built already, so a Mac with no compiler
 * never needs one.
 */
export async function nativeBinary(build: NativeBuild): Promise<string> {
  const helpers = process.env.APPDYNO_HELPERS;
  if (helpers && existsSync(join(helpers, build.name))) return join(helpers, build.name);
  const hash = createHash('sha256');
  for (const file of [...build.sources, ...(build.headers ?? [])])
    hash.update(await readFile(file));
  const id = hash.update(build.flags.join(' ')).digest('hex').slice(0, 16);
  // whatever the state directory: a build is the same build for every one of them
  const root = process.env.APPDYNO_NATIVE_DIR ?? join(homedir(), 'Library/Caches/appdyno/native');
  const dir = join(root, id);
  const binary = join(dir, build.name);
  if (existsSync(binary)) return binary;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${binary}.${randomBytes(4).toString('hex')}`;
  await run('xcrun', [...build.flags, '-o', tmp, ...build.sources], {
    ...(build.env && { env: build.env }),
    timeout: COMPILE_MS,
  }).catch((e: Error) => {
    if (/ENOENT|invalid active developer path|xcrun: error/.test(e.message))
      throw new NeedError('no-compiler');
    throw e;
  });
  await chmod(tmp, 0o700);
  await rename(tmp, binary);
  return binary;
}

/** Whether this Mac can compile a helper: Command Line Tools are enough. */
export async function compilerCheck(env?: NodeJS.ProcessEnv): Promise<Check> {
  try {
    const { stdout } = await run('xcrun', ['--find', 'clang'], {
      ...(env && { env }),
      timeout: 30_000,
    });
    return { name: 'compiler', ok: true, detail: stdout.trim() };
  } catch {
    return {
      name: 'compiler',
      ok: false,
      warn: true,
      detail: NEEDS['no-compiler'].title,
      fix: NEEDS['no-compiler'].fix,
    };
  }
}
