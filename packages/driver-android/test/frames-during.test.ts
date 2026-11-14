import { describe, expect, it } from 'vitest';
import { framesDuring } from '../src/perf/frames.js';
import type { PerfDevice } from '../src/perf/shared.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';

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
  // the app shows no surface of its own: what it draws, the View toolkit counts
  const next = (command: string) =>
    Promise.resolve(command.includes('SurfaceFlinger') ? '' : (left.shift() ?? reads.at(-1)));
  return {
    serial: 'x',
    readyToMeasure: () => Promise.resolve(),
    shell: next,
    shellAlongside: next,
  } as unknown as PerfDevice;
}

describe('frames of what ran, on Android', () => {
  it(
    'reads one stall as one, though it held up the next frame and the summary doubles them',
    fakeTimed(async () => {
      const stall = [row(1_000, 1_012), row(1_016, 1_014), row(2_030, 8)];
      const { value } = await framesDuring(
        device(['', dump(1000, 4, [row(0, 8), ...stall])]),
        'dev.app',
        0,
        () => Promise.resolve(),
      );
      expect(value.frozenFrames).toBe(1);
    }),
  );

  it(
    "corrects Play's numbers with the count, and leaves the slow share the summary's",
    fakeTimed(async () => {
      const stall = [row(1_000, 1_012), row(1_016, 1_014), row(2_030, 8)];
      const { value } = await framesDuring(
        device(['', dump(1000, 4, [row(0, 8), ...stall])]),
        'dev.app',
        0,
        () => Promise.resolve(),
      );
      expect(value.histogram).toEqual({ frames: 142, over16: 4, over700: 1, rowFrames: 4 });
    }),
  );

  it(
    'counts no frozen frame of a row that ends after the read, and counts that row once over reads',
    fakeTimed(async () => {
      // as an emulator gave: its frame ends 2^56 ns on, read 3 s after the boot
      const garbage = '0,2000000000,2000000000,16666667,72057628414509166';
      const read = `Uptime: 3000 Realtime: 3000\n${dump(1000, 0, [row(1_000, 8), garbage])}`;
      const { value } = await framesDuring(
        device(['', read, read, read]),
        'dev.app',
        0,
        () => new Promise((r) => setTimeout(r, 700)),
      );
      expect(value.frozenFrames).toBe(0);
      expect(value.badRows).toBe(1);
      expect(value.histogram?.rowFrames).toBe(1);
    }),
  );

  it(
    'keeps what the ring has since lost, and counts two stalls apart',
    fakeTimed(async () => {
      const first = dump(1000, 0, [row(1_000, 1_000)]);
      const later = dump(1000, 4, [row(5_000, 900)]);
      const { value } = await framesDuring(
        device(['', first, later, later, later]),
        'dev.app',
        0,
        () => new Promise((r) => setTimeout(r, 700)),
      );
      expect(value.frozenFrames).toBe(2);
    }),
  );

  it(
    'takes the janky share of the frames there were, where the summary counts each twice',
    fakeTimed(async () => {
      const rows = [row(0, 40), row(40, 40), row(80, 40), row(120, 8)];
      const summary = (total: number, janky: string) =>
        [`Total frames rendered: ${total}`, `Janky frames: ${janky}`, '---PROFILEDATA---', HEAD]
          .concat(rows, '---PROFILEDATA---')
          .join('\n');
      const share = async (text: string) =>
        (await framesDuring(device(['', text]), 'dev.app', 0, () => Promise.resolve())).value
          .jankyPercent;
      expect(await share(summary(8, '3 (37.50%)'))).toBe(75);
      expect(await share(summary(4, '3 (75.00%)'))).toBe(75);
    }),
  );

  it(
    'reads a plain list as none, and at least one where only the summary saw it',
    fakeTimed(async () => {
      const plain = await framesDuring(device(['', dump(5, 0, [row(0, 8)])]), 'dev.app', 0, () =>
        Promise.resolve(),
      );
      expect(plain.value.frozenFrames).toBe(0);
      const lost = await framesDuring(device(['', dump(1000, 4, [row(0, 8)])]), 'dev.app', 0, () =>
        Promise.resolve(),
      );
      expect(lost.value.frozenFrames).toBe(1);
    }),
  );
});
