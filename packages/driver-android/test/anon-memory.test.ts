import { describe, expect, it } from 'vitest';
import { parseAnonMemory } from '../src/perf/parse.js';

const READ = (procState: number, swap = 'VmSwap:\t   15580 kB\n') => `RssAnon:\t   80960 kB
${swap}MemTotal:        7849448 kB
curProcState=${procState}
   Bitmap (malloced):       83                           2516
   Bitmap (nonmalloced):     2                           1000
`;

describe('the memory Play judges', () => {
  it('adds anon RSS and swap, and both kinds of bitmap', () => {
    expect(parseAnonMemory(READ(2))).toEqual({
      kb: 96_540,
      rssAnonKb: 80_960,
      swapKb: 15_580,
      state: 'foreground',
      processState: 2,
      bitmapKb: 3_516,
      ramMb: 7_665,
    });
  });

  it('has no bitmaps where this Android lists no such row, rather than a zero', () => {
    const read = parseAnonMemory(READ(2).replace(/^.*Bitmap.*\n/gm, ''));
    expect(read.kb).toBe(96_540);
    expect(read.bitmapKb).toBeUndefined();
  });

  it('has no swap where a kernel prints none', () => {
    expect(parseAnonMemory(READ(2, '')).kb).toBe(80_960);
  });

  it.each([
    [2, 'foreground'],
    [3, 'foreground'],
    [4, 'service'],
    [6, 'service'],
    [7, 'background'],
    [12, 'background'],
    [15, 'background'],
    [16, 'cached'],
    [19, 'cached'],
  ])('process state %i reads as %s', (procState, state) => {
    expect(parseAnonMemory(READ(procState)).state).toBe(state);
  });

  it('refuses a read with none of it, rather than a zero', () => {
    expect(() => parseAnonMemory('nothing here')).toThrow(/no RssAnon/);
  });
});
