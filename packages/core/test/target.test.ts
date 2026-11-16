import { describe, expect, it } from 'vitest';
import {
  chosen,
  must,
  seek,
  seekOn,
  settleBy,
  waitUntil,
  type Reader,
  type Reads,
  type ScreenElement,
} from '../src/index.js';

type Read = { list: ScreenElement[]; hash: string };

const el = (ref: string, label: string, y: number): ScreenElement => ({
  ref,
  role: 'button',
  label,
  name: label,
  nameKind: 'label',
  rect: { x: 0, y, width: 200, height: 40 },
  x: 100,
  y: y + 20,
  flags: ['clickable'],
});
const read = (hash: string, ...list: ScreenElement[]): Read => ({ list, hash });
const READS: Reads<Read, ScreenElement> = {
  list: (x) => x.list,
  byRef: (x, ref) => x.list.find((e) => e.ref === ref),
};

/** A reader over reads that come one after another, the last for good; `waited`: what its waits were asked for. */
function readerOf(...reads: Read[]) {
  const waited: number[] = [];
  let at = 0;
  const next = () => must(reads[Math.min(at++, reads.length - 1)], 'a read');
  const reader: Reader<Read> = {
    now: () => Promise.resolve(next()),
    until: (met, ms) => {
      waited.push(ms);
      for (;;) {
        const screen = next();
        if (met(screen)) return Promise.resolve({ screen, met: true });
        if (at >= reads.length) return Promise.resolve({ screen, met: false });
      }
    },
  };
  return { reader, waited };
}

describe('a target on a read', () => {
  const play = el('@a1', 'Play', 0);
  const both = read('h', play, el('@a2', 'Play', 100), el('@a3', 'Stop', 200));

  it('is the one element a ref or a selector names', () => {
    expect(seekOn(both, { ref: '@a3' }, READS)).toMatchObject({ element: { label: 'Stop' } });
    expect(seekOn(both, { text: 'Stop' }, READS)).toMatchObject({ element: { ref: '@a3' } });
    expect(seekOn(both, { text: 'Play', index: 1 }, READS)).toMatchObject({
      element: { ref: '@a2' },
    });
  });

  it('says why it names none: no ref, no match, an index past the last, several apart', () => {
    expect(seekOn(both, { ref: '@zz' }, READS)).toMatchObject({ miss: 'ref' });
    expect(seekOn(both, { text: 'Pause' }, READS)).toMatchObject({ miss: 'none', hits: [] });
    expect(seekOn(both, { text: 'Play', index: 2 }, READS)).toMatchObject({ miss: 'index' });
    const several = seekOn(both, { text: 'Play' }, READS);
    expect(several).toMatchObject({ miss: 'several' });
    expect('hits' in several && several.hits.map((e) => e.ref)).toEqual(['@a1', '@a2']);
    expect(chosen([], 0)).toEqual({ miss: 'none' });
  });
});

describe('a target on the screen just now', () => {
  const stop = el('@a3', 'Stop', 200);

  it('takes a ref on the read just taken, and waits for none', async () => {
    const { reader, waited } = readerOf(read('h1', stop));
    expect(await seek(reader, { ref: '@a3' }, READS, 1_500)).toMatchObject({
      element: stop,
      screen: { hash: 'h1' },
    });
    expect(waited).toEqual([]);
  });

  it('waits for a ref a short read left out, and finds it on the read that has it', async () => {
    const { reader, waited } = readerOf(read('h1'), read('h2'), read('h3', stop));
    expect(await seek(reader, { ref: '@a3' }, READS, 1_500)).toMatchObject({
      element: stop,
      screen: { hash: 'h3' },
    });
    expect(waited).toEqual([1_500]);
  });

  it('says a ref is not there with the last screen it saw', async () => {
    const { reader } = readerOf(read('h1'), read('h2', el('@a1', 'Play', 0)));
    expect(await seek(reader, { ref: '@a3' }, READS, 1_500)).toMatchObject({
      miss: 'ref',
      screen: { hash: 'h2' },
    });
  });

  it('waits for a selector still coming, and says a screen that never read', async () => {
    const { reader, waited } = readerOf(read('h1'), read('h2', stop));
    expect(await seek(reader, { text: 'Stop' }, READS, 700)).toMatchObject({ element: stop });
    expect(waited).toEqual([700]);
    const unread: Reader<Read> = {
      now: () => Promise.reject(new Error('unread')),
      until: () => Promise.resolve({ met: false }),
    };
    expect(await seek(unread, { text: 'Stop' }, READS, 700)).toEqual({ miss: 'unread', hits: [] });
  });
});

describe('a settle by reads', () => {
  it('rests on the layout that held, and never on the one it was told is none', async () => {
    let n = 0;
    const next = () => Promise.resolve({ hash: n++ === 0 ? 'a' : 'b' });
    const rested = await settleBy(next, 60, 2_000);
    expect(rested).toMatchObject({ screen: { hash: 'b' }, settled: true });
    expect(rested.ms).toBeGreaterThanOrEqual(60);
    const never = await settleBy(() => Promise.resolve({ hash: 'home' }), 20, 150, 'home');
    expect(never).toMatchObject({ settled: false });
    expect(never.ms).toBeGreaterThanOrEqual(150);
  });
});

describe('a wait for a screen', () => {
  it('waits on the device where it can, and ends when it says nothing changed', async () => {
    const asked: (string | undefined)[] = [];
    const got = await waitUntil<Read>(
      {
        read: () => Promise.reject(new Error('no read where the device waits')),
        changed: (since) => {
          asked.push(since);
          return Promise.resolve(
            since === undefined
              ? { sig: 's1', screen: read('h1') }
              : { sig: 's1', unchanged: true },
          );
        },
      },
      () => false,
      1_000,
    );
    expect(got).toEqual({ screen: read('h1'), met: false });
    expect(asked).toEqual([undefined, 's1']);
  });

  it('reads by itself where the device cannot wait, and a failed read is no answer', async () => {
    const reads = [undefined, read('h1'), read('h2', el('@a1', 'Play', 0))];
    let n = 0;
    const got = await waitUntil<Read>(
      { read: () => Promise.resolve(reads[n++]), changed: () => Promise.resolve(undefined) },
      (s) => s.list.length > 0,
      5_000,
    );
    expect(got).toMatchObject({ met: true, screen: { hash: 'h2' } });
  });
});
