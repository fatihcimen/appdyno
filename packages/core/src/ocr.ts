import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODE_FLAGS, type Tree, type WireNode } from '@appdyno/protocol';
import { NeedError } from './mirror/need.js';
import { nativeBinary } from './native.js';
import { run } from './run.js';

/** Under a second, at load 15 or 68 and with the Neural Engine's compiler busy: a read must not wait on more. */
const SCAN_MS = 10_000;

/** A run of words on a picture, in fractions of it from its top left corner. */
export type PictureText = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
};

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

/** The words of an image, by the Mac's own Vision. The picture is a file for this user alone, and is gone after. */
export async function readPicture(image: Buffer): Promise<PictureText[]> {
  const binary = await nativeBinary({
    name: 'TextScan',
    sources: [scanSource()],
    flags: FLAGS,
  }).catch((e: Error) => {
    if (/ENOENT|invalid active developer path|xcrun: error/.test(e.message))
      throw new NeedError('no-compiler');
    throw e;
  });
  const dir = await mkdtemp(join(tmpdir(), 'appdyno-scan-'));
  try {
    const file = join(dir, 'screen');
    await writeFile(file, image, { mode: 0o600 });
    const { stdout } = await run(binary, [file], { timeout: SCAN_MS });
    return JSON.parse(stdout) as PictureText[];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
