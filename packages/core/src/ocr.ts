import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODE_FLAGS, type Tree, type WireNode } from '@appdyno/protocol';
import { NeedError } from './mirror/need.js';
import { nativeBinary } from './native.js';
import { pause } from './call.js';
import { run } from './run.js';
import { stateDir } from './state.js';

/** Under a second, at load 15 or 68 and with the Neural Engine's compiler busy: a read must not wait on more. */
const SCAN_MS = 10_000;
/** How long a read waits for the accurate level: a third of a second once the system has compiled for such a picture. */
const ACCURATE_WAIT_MS = 3_000;
const ACCURATE_POLL_MS = 100;
/** How long an accurate scan may live: 235 s was seen, and a kill throws its work away. */
const ACCURATE_LIVES_S = 600;
/** How long an accurate scan's words may stay on disk unread: they are a person's screen. */
const KEPT_S = 300;
/** Run in the folder: however the scan ends, by itself, by its limit or by a crash, its marks go, and then its words. */
const afterScan = (keptS: number) =>
  `umask 077; "$@"; rm -f running picture; sleep ${keptS}; rm -f accurate.json`;

/** A run of words on a picture, in fractions of it from its top left corner. */
export type PictureText = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
};

/** The words of a picture, and the level that read them: the fast one knows Latin letters only. */
export type PictureWords = { words: PictureText[]; level: 'accurate' | 'fast' };

/** What read a node from the picture: no platform has this class. */
export const PICTURE_TEXT = 'PictureText';

const FLAGS = ['clang', '-fobjc-arc', '-framework', 'Foundation', '-framework', 'Vision'];

/** The source, beside the repository's packages or inside the published one. */
function scanSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = [
    join(here, '../../../mac/TextScan.m'),
    join(here, '../agents/mac-src/TextScan.m'),
  ].find((p) => existsSync(p));
  if (!source) throw new Error('the source of TextScan is missing');
  return source;
}

/** The scanner, ready to run. */
export const textScanner = () =>
  nativeBinary({
    name: 'TextScan',
    sources: [scanSource()],
    flags: FLAGS,
  }).catch((e: Error) => {
    if (/ENOENT|invalid active developer path|xcrun: error/.test(e.message))
      throw new NeedError('no-compiler');
    throw e;
  });

/** The fast level: no gate or person waits on a system service. The picture is a file for this user alone, and is gone after. */
export async function fastWords(image: Buffer, binary?: string): Promise<PictureText[]> {
  const scan = binary ?? (await textScanner());
  const dir = await mkdtemp(join(tmpdir(), 'appdyno-scan-'));
  try {
    const file = join(dir, 'screen');
    await writeFile(file, image, { mode: 0o600 });
    const { stdout } = await run(scan, [file], { timeout: SCAN_MS });
    return JSON.parse(stdout) as PictureText[];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** What the last accurate scan left for this picture, which goes once read. Older than it may be, it goes unread. */
async function keptWords(folder: string, key: string, keptS: number) {
  const file = join(folder, 'accurate.json');
  const since = await stat(file).catch(() => undefined);
  if (!since) return undefined;
  if (Date.now() - since.mtimeMs > keptS * 1_000) {
    await rm(file, { force: true });
    return undefined;
  }
  const found = JSON.parse(await readFile(file, 'utf8')) as { key: string; words: PictureText[] };
  if (found.key !== key) return undefined;
  await rm(file, { force: true });
  return found.words;
}

/** One accurate scan at a time, on this Mac: false while one is at work. One that died took nothing with it. */
async function startAccurate(
  binary: string,
  folder: string,
  key: string,
  image: Buffer,
  keptS: number,
) {
  const running = join(folder, 'running');
  const since = await stat(running).catch(() => undefined);
  if (since && Date.now() - since.mtimeMs < ACCURATE_LIVES_S * 1_000) return false;
  await rm(running, { force: true });
  if (
    !(await writeFile(running, key, { flag: 'wx' }).then(
      () => true,
      () => false,
    ))
  )
    return false;
  await writeFile(join(folder, 'picture'), image, { mode: 0o600 });
  // in a process of its own, as this one may end first
  const args = [binary, 'picture', '.', key, String(ACCURATE_LIVES_S)];
  const scan = spawn('/bin/sh', ['-c', afterScan(keptS), 'scan', ...args], {
    cwd: folder,
    detached: true,
    stdio: 'ignore',
  });
  scan.on('error', () => void rm(running, { force: true }));
  scan.unref();
  return true;
}

/**
 * The words of an image, by the Mac's own Vision: the accurate level's when they come in time, or are there from an
 * earlier look at this same picture, else the fast level's, with the accurate scan left to finish for the next look.
 */
export async function readPicture(
  image: Buffer,
  binary?: string,
  keptS = KEPT_S,
): Promise<PictureWords> {
  const scan = binary ?? (await textScanner());
  const folder = join(stateDir(), 'picture-words');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const key = createHash('sha256').update(image).digest('hex');
  const kept = await keptWords(folder, key, keptS);
  if (kept) return { words: kept, level: 'accurate' };
  if (await startAccurate(scan, folder, key, image, keptS)) {
    const end = Date.now() + ACCURATE_WAIT_MS;
    while (Date.now() < end && existsSync(join(folder, 'running'))) await pause(ACCURATE_POLL_MS);
    const words = await keptWords(folder, key, keptS);
    if (words) return { words, level: 'accurate' };
  }
  return { words: await fastWords(image, scan), level: 'fast' };
}

/**
 * The tree with the picture's words as nodes of the app's window: refs, selectors, diffs and checks then take them as
 * any other. `size` is the screen in tap units.
 */
export function withPictureText(
  tree: Tree,
  found: PictureText[],
  size: { w: number; h: number },
): Tree {
  const window = Math.max(
    tree.windows.findIndex((w) => w.type === 1),
    0,
  );
  const root = tree.nodes.findIndex((n) => n.p === -1 && n.w === window);
  const nodes = found.map((t): WireNode => ({
    p: root,
    w: window,
    c: PICTURE_TEXT,
    t: t.text,
    b: [
      Math.round(t.x * size.w),
      Math.round(t.y * size.h),
      Math.round((t.x + t.w) * size.w),
      Math.round((t.y + t.h) * size.h),
    ],
    f: NODE_FLAGS.visible | NODE_FLAGS.enabled,
  }));
  return { ...tree, nodes: [...tree.nodes, ...nodes] };
}
