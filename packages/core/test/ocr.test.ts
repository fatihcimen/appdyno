import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Tree } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { PICTURE_TEXT, readPicture, withPictureText } from '../src/ocr.js';

/** The first use compiles it, on a Mac that may be busy. */
const COMPILE_MS = 300_000;

const tree = (): Tree => ({
  windows: [
    { type: 1, pkg: 'dev.app', layer: 1, b: [0, 0, 1000, 2000], active: true, focused: true },
  ],
  nodes: [{ p: -1, w: 0, c: 'View', b: [0, 0, 1000, 2000], f: 17 }],
  truncated: false,
  elapsedMs: 1,
  hash: 'h',
});

describe('the words of a picture', () => {
  it(
    'reads them with their places, by the Mac alone',
    async () => {
      const found = await readPicture(
        readFileSync(join(import.meta.dirname, 'fixtures/words.png')),
      );
      expect(found.map((t) => t.text)).toEqual(['Start Game', 'High Score 42']);
      const [first, second] = found;
      // the picture's top left is the origin: the first line is above the second
      expect(first!.y).toBeLessThan(second!.y);
      expect(first!.x).toBeGreaterThan(0.05);
      expect(first!.y).toBeLessThan(0.3);
    },
    COMPILE_MS,
  );

  it('says what went wrong with a file that is no picture', async () => {
    await expect(readPicture(Buffer.from('nothing'))).rejects.toThrow();
  });

  it('puts them in the tree as text of the app, in tap units, leaving the digest', () => {
    const t = withPictureText(
      tree(),
      [{ text: 'Play', x: 0.1, y: 0.25, w: 0.5, h: 0.05, confidence: 1 }],
      { w: 1000, h: 2000 },
    );
    expect(t.hash).toBe('h');
    expect(t.nodes[1]).toMatchObject({
      p: 0,
      w: 0,
      c: PICTURE_TEXT,
      t: 'Play',
      b: [100, 500, 600, 600],
    });
  });
});
