import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tree } from '@appdyno/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fastWords, PICTURE_TEXT, readPicture, withPictureText } from '../src/ocr.js';

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
      const found = await fastWords(readFileSync(join(import.meta.dirname, 'fixtures/words.png')));
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
    await expect(fastWords(Buffer.from('nothing'))).rejects.toThrow();
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

describe('which level answers', () => {
  const WORDS = '[{"text":"fast","x":0,"y":0,"w":1,"h":1,"confidence":1}]';
  const ACCURATE = '{"key":"%s","words":[{"text":"doğru","x":0,"y":0,"w":1,"h":1,"confidence":1}]}';
  /** A scanner like the real one, with no Vision in it: its accurate level takes this long. */
  const scanner = (seconds: number) => {
    const file = join(mkdtempSync(join(tmpdir(), 'appdyno-fake-scan-')), 'scan');
    writeFileSync(
      file,
      `#!/bin/bash
[[ $# == 1 ]] && { echo '${WORDS}'; exit; }
rm -f "$1"
/bin/bash -c 'read -t ${seconds} < /dev/zero'
printf '${ACCURATE}' "$3" > "$2/accurate.json"
`,
    );
    chmodSync(file, 0o700);
    return file;
  };
  const texts = (r: Awaited<ReturnType<typeof readPicture>>) => [r.level, r.words[0]!.text];
  const inFolder = (name: string) => join(process.env.APPDYNO_STATE_DIR!, 'picture-words', name);
  const ended = () =>
    vi.waitFor(() => expect(existsSync(inFolder('running'))).toBe(false), { timeout: 8_000 });
  /** Accurate words left unread, which this keeps a while. */
  const left = async (keptS: number) => {
    expect(texts(await readPicture(Buffer.from('a'), scanner(4), keptS))).toEqual(['fast', 'fast']);
    await ended();
    expect(existsSync(inFolder('accurate.json'))).toBe(true);
  };

  beforeEach(() => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-ocr-')));
  });

  it('answers from the accurate level when it comes in time', async () => {
    expect(texts(await readPicture(Buffer.from('a'), scanner(0), 1))).toEqual([
      'accurate',
      'doğru',
    ]);
  });

  it('answers from the fast level otherwise, and keeps the accurate words for the next look', async () => {
    await left(30);
    expect(texts(await readPicture(Buffer.from('a'), scanner(4), 30))).toEqual([
      'accurate',
      'doğru',
    ]);
  }, 15_000);

  it("keeps a person's words from everyone else, and only until they are read", async () => {
    await left(30);
    expect(statSync(inFolder('accurate.json')).mode & 0o777).toBe(0o600);
    expect(statSync(inFolder('.')).mode & 0o777).toBe(0o700);
    await readPicture(Buffer.from('a'), scanner(4), 30);
    expect(existsSync(inFolder('accurate.json'))).toBe(false);
    expect(existsSync(inFolder('picture'))).toBe(false);
  }, 15_000);

  it('takes them away unread after a while, with nothing else running', async () => {
    await left(1);
    await vi.waitFor(() => expect(existsSync(inFolder('accurate.json'))).toBe(false), {
      timeout: 4_000,
    });
  }, 15_000);

  it('does not trust words that outlived what cleared them, and takes them away', async () => {
    await left(30);
    const long = new Date(Date.now() - 60_000);
    utimesSync(inFolder('accurate.json'), long, long);
    const r = await readPicture(Buffer.from('a'), scanner(0), 30);
    expect(r.words[0]!.text).toBe('doğru');
    expect(existsSync(inFolder('accurate.json'))).toBe(false);
  }, 15_000);

  it('starts no second accurate scan while one is at work, and does not wait for it', async () => {
    const slow = scanner(6);
    await readPicture(Buffer.from('a'), slow, 1);
    expect(texts(await readPicture(Buffer.from('b'), slow, 1))).toEqual(['fast', 'fast']);
    // answered while the first is still at work: that is the order that shows it did not wait, however busy this Mac is
    const running = join(process.env.APPDYNO_STATE_DIR!, 'picture-words/running');
    expect(readFileSync(running, 'utf8')).toBe(createHash('sha256').update('a').digest('hex'));
  }, 15_000);
});
