import { describe, expect, it } from 'vitest';
import { parseFrameCauses } from '../src/perf/frame-cause.js';

const HEAD = '"cause","ns","frames","longest","detail"';
const row = (cause: string, ms: number, frames: number, detail = '[NULL]') =>
  `"${cause}",${ms * 1e6},${frames},0,"${detail}"`;
const slow = (frames: number) => row('slow_frames', 0, frames);

describe('why the frames that missed did', () => {
  it('names a wait, and takes it out of the sleep it also is', () => {
    const c = parseFrameCauses(
      [
        HEAD,
        row('busy', 200, 10),
        row('lock', 900, 10, 'Thread-6 in FrozenActivity.onCreate'),
        row('sleeping', 950, 10),
        slow(10),
      ].join('\n'),
    )!;
    expect(c.top).toBe('lock');
    expect(c.causes[0]).toEqual({
      cause: 'lock',
      msPerFrame: 90,
      share: 78.3,
      frames: 10,
      detail: 'Thread-6 in FrozenActivity.onCreate',
    });
    // what is left of the sleep, once the wait is taken out of it
    expect(c.causes.find((x) => x.cause === 'sleeping')!.msPerFrame).toBe(5);
    expect(c.slowFrames).toBe(10);
  });

  it('calls a smooth run no slow frames, and names nothing', () => {
    expect(parseFrameCauses([HEAD, slow(0)].join('\n'))).toEqual({ slowFrames: 0, causes: [] });
  });

  it('names nothing when no cause holds a frame long enough', () => {
    const c = parseFrameCauses([HEAD, row('busy', 50, 10), slow(10)].join('\n'))!;
    expect(c.top).toBeUndefined();
    expect(c.causes).toHaveLength(1);
  });

  it('names nothing when the time is spread across causes', () => {
    const rows = ['busy', 'starved', 'io'].map((x) => row(x, 300, 10));
    const c = parseFrameCauses([HEAD, ...rows, slow(10)].join('\n'))!;
    expect(c.top).toBeUndefined();
  });

  it('has nothing to say of a query with no rows', () => {
    expect(parseFrameCauses(HEAD)).toBeUndefined();
  });
});
