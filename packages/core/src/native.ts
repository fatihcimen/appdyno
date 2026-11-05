import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Check } from './device.js';
import { NEEDS } from './mirror/need.js';
import { run } from './run.js';

/** How long a first compile may take on a loaded Mac: 25 s was measured at load 270. */
const COMPILE_MS = 300_000;

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
