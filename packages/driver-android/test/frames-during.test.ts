import { describe, expect, it } from 'vitest';
import { framesDuring } from '../src/perf/frames.js';
import type { PerfDevice } from '../src/perf/shared.js';

const HEAD = 'Flags,IntendedVsync,Vsync,FrameInterval,FrameCompleted';
const row = (startMs: number, ms: number) =>
  `0,${startMs * 1e6},${startMs * 1e6},16666667,${(startMs + ms) * 1e6}`;
const dump = (histogramMs: number, count: number, rows: string[]) =>
  [
    'Total frames rendered: 142',
    'Janky frames: 2 (1.41%)',
    `HISTOGRAM: 5ms=138 ${histogramMs}ms=${count}`,
    '---PROFILEDATA---',
    HEAD,
    ...rows,
    '---PROFILEDATA---',
  ].join('\n');

function device(reads: string[]) {
  const left = [...reads];
  const next = async () => left.shift() ?? reads.at(-1)!;
  return {
    serial: 'x',
    readyToMeasure: async () => undefined,
    shell: next,
    shellAlongside: next,
  } as unknown as PerfDevice;
}

describe('frames of what ran, on Android', () => {
  it('reads one stall as one, though it held up the next frame and the summary doubles them', async () => {
    const stall = [row(1_000, 1_012), row(1_016, 1_014), row(2_030, 8)];
    const { value } = await framesDuring(
      device(['', dump(1000, 4, [row(0, 8), ...stall])]),
      'dev.app',
      0,
      async () => undefined,
    );
    expect(value.frozenFrames).toBe(1);
  });

  it("corrects Play's numbers with the count, and leaves the slow share the summary's", async () => {
    const stall = [row(1_000, 1_012), row(1_016, 1_014), row(2_030, 8)];
    const { value } = await framesDuring(
      device(['', dump(1000, 4, [row(0, 8), ...stall])]),
      'dev.app',
      0,
      async () => undefined,
    );
    expect(value.histogram).toEqual({ frames: 142, over16: 4, over700: 1, rowFrames: 4 });
  });

  it('keeps what the ring has since lost, and counts two stalls apart', async () => {
    const first = dump(1000, 0, [row(1_000, 1_000)]);
    const later = dump(1000, 4, [row(5_000, 900)]);
    const { value } = await framesDuring(
      device(['', first, later, later, later]),
      'dev.app',
      0,
      () => new Promise((r) => setTimeout(r, 700)),
    );
    expect(value.frozenFrames).toBe(2);
  });

  it('reads a plain list as none, and at least one where only the summary saw it', async () => {
    const plain = await framesDuring(
      device(['', dump(5, 0, [row(0, 8)])]),
      'dev.app',
      0,
      async () => undefined,
    );
    expect(plain.value.frozenFrames).toBe(0);
    const lost = await framesDuring(
      device(['', dump(1000, 4, [row(0, 8)])]),
      'dev.app',
      0,
      async () => undefined,
    );
    expect(lost.value.frozenFrames).toBe(1);
  });
});
