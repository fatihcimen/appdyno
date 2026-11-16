import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { arch } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { downloadPinned, reportProgress, run } from '@appdyno/core';
import { xcodeEnv } from './simctl.js';

/**
 * What a release says of the simulator runner it built and attached: written into the package, beside the sources the
 * runner is of, so the checksum comes with the package and not from where the file does.
 */
const Prebuilt = z.object({
  version: z.string(),
  /** The first 16 of the sources' sha256, as a build is kept by. */
  id: z.string(),
  file: z.string().regex(/^[\w.-]+$/),
  sha256: z.string(),
  bytes: z.number(),
  /** The Xcode that built it. */
  xcode: z.string(),
});
type Prebuilt = z.infer<typeof Prebuilt>;
export const PREBUILT = 'prebuilt.json';

const RELEASES = 'https://github.com/fatihcimen/appdyno/releases/download';
const FETCH_MS = 120_000;
/** In a runner's folder: it was fetched, and of which release. */
const FETCHED = 'fetched.json';
/** Beside a runner's folder: the fetched one did not start on this Mac, and is not asked for again. */
const UNFIT = 'unfit';

/** What decides whether the release's runner is asked for on this Mac. */
export type Here = { xcode: string | undefined; arch: string; noFetch: boolean };

async function here(): Promise<Here> {
  const noFetch = process.env.APPDYNO_NO_FETCH === '1';
  const { stdout } = noFetch
    ? { stdout: '' }
    : await run('xcodebuild', ['-version'], { timeout: 30_000, env: xcodeEnv() }).catch(() => ({
        stdout: '',
      }));
  return { xcode: /^Xcode (\S+)/.exec(stdout)?.[1], arch: arch(), noFetch };
}

const major = (xcode: string | undefined) => Number.parseInt(xcode ?? '', 10);

/** Why the release's runner is not asked for, decided before any request is made; nothing where it may be. */
export function notFetched(
  prebuilt: Prebuilt | undefined,
  id: string,
  out: string,
  at: Here,
): string | undefined {
  if (at.noFetch) return 'APPDYNO_NO_FETCH is set';
  if (!prebuilt) return 'this build of appdyno names none';
  if (prebuilt.id !== id) return `the release's is of other sources (${prebuilt.id})`;
  if (at.arch !== 'arm64') return "the release's is for a Mac with Apple silicon";
  if (existsSync(join(dirname(out), UNFIT))) return 'the fetched one did not start on this Mac';
  // one major version apart ran both ways, 26.5 and 27.2, with the frameworks of the Xcode that runs it; further was not tried
  if (!(Math.abs(major(prebuilt.xcode) - major(at.xcode)) <= 1))
    return `the release's is built by Xcode ${prebuilt.xcode}, and this is Xcode ${at.xcode ?? 'unknown'}`;
  return undefined;
}

const say = (line: string) => {
  process.stderr.write(`${line}\n`);
  reportProgress(line);
};

/**
 * The release's simulator runner in `out`, as a build leaves one, for the sources `id` names in `src`: whether it is
 * there now. Why it is not is said in a line and never thrown, as a build follows.
 */
export async function fetchRunner(
  src: string,
  id: string,
  out: string,
  at?: Here,
): Promise<boolean> {
  try {
    const prebuilt = await readFile(join(src, PREBUILT), 'utf8').then(
      (text) => Prebuilt.parse(JSON.parse(text)),
      () => undefined,
    );
    const why = notFetched(prebuilt, id, out, at ?? (await here()));
    if (why || !prebuilt) throw new Error(why);
    const base = process.env.APPDYNO_RUNNER_URL ?? `${RELEASES}/v${prebuilt.version}`;
    const data = await downloadPinned(`${base}/${prebuilt.file}`, prebuilt.sha256, FETCH_MS);
    await mkdir(dirname(out), { recursive: true, mode: 0o700 });
    // beside where it goes, so the rename crosses no volume: the folder appears whole, or not at all
    const tmp = await mkdtemp(`${out}.`);
    try {
      const zip = join(tmp, 'runner.zip');
      await writeFile(zip, data);
      const products = join(tmp, 'Build/Products');
      await mkdir(products, { recursive: true });
      await run('unzip', ['-q', zip, '-d', products], { timeout: 120_000 });
      await rm(zip);
      await writeFile(join(tmp, FETCHED), JSON.stringify({ version: prebuilt.version }));
      await rename(tmp, out);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
    say(
      `fetched the simulator runner (${(prebuilt.bytes / 1e6).toFixed(1)} MB) for v${prebuilt.version}`,
    );
    return true;
  } catch (e) {
    const why = (e instanceof Error ? e.message : String(e)).split('\n', 1)[0] ?? '';
    say(`the simulator runner is built here, not fetched: ${why}`);
    return false;
  }
}

/** The folder a runner's products are in, as a build or a fetch made it. */
const folderOf = (products: string) => join(products, '../..');

/** The release a runner's products were fetched for, where they were. */
export function fetchedFor(products: string): string | undefined {
  try {
    const { version } = z
      .object({ version: z.string() })
      .parse(JSON.parse(readFileSync(join(folderOf(products), FETCHED), 'utf8')));
    return version;
  } catch {
    return undefined;
  }
}

/**
 * A fetched runner that did not start: removed, and not asked for again for these sources, so the next is built
 * here. Whether it was a fetched one.
 */
export async function dropFetched(xctestrun: string): Promise<boolean> {
  const out = folderOf(dirname(xctestrun));
  if (!existsSync(join(out, FETCHED))) return false;
  await writeFile(join(dirname(out), UNFIT), '');
  await rm(out, { recursive: true, force: true });
  return true;
}
