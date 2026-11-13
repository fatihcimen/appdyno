import { describe, expect, it, vi } from 'vitest';
import {
  parseLatency,
  surfaceFrames,
  surfaceLayers,
  surfaceStats,
  watchSurface,
} from '../src/perf/surface.js';
import type { PerfDevice } from '../src/perf/shared.js';

const PERIOD = 16_666_666;

/** `--latency` for frames this many refreshes apart, each landing a little off its refresh, as a real one does. */
const latency = (gaps: number[]) => {
  let t = 3_000_000_000_000;
  const rows = ['0\t0\t0', '0\t0\t0', `${t}\t${t}\t${t}`];
  gaps.forEach((n, i) => {
    t += n * PERIOD;
    const off = i % 2 ? 150_000 : -150_000;
    rows.push(`${t}\t${t + off}\t${t}`);
  });
  return `${PERIOD}\n${rows.join('\n')}\n`;
};

const stats = (gaps: number[]) =>
  surfaceStats('SurfaceView[x](BLAST)#1', parseLatency(latency(gaps)), true);

describe('frames of a surface', () => {
  it('reads what was presented, and leaves out what is empty or still on its way', () => {
    const read = parseLatency(
      `16666666\n0\t0\t0\n5\t100\t5\n6\t9223372036854775807\t6\n7\t200\t7\n`,
    );
    expect(read).toEqual({ periodNs: PERIOD, presents: [100, 200] });
  });

  it('calls nothing slow at 30 frames a second, each two refreshes apart', () => {
    const s = stats(Array.from({ length: 60 }, () => 2));
    expect(s).toMatchObject({
      refreshMs: 16.7,
      frames: 61,
      p50Ms: 33.3,
      slow34Percent: 0,
      slow50Percent: 0,
    });
    expect(s.fps).toBeCloseTo(30, 0);
  });

  it('calls a frame presented 50 ms after the last slow, as Play does, wherever the clock put it', () => {
    // 25 frames a second on a 60 Hz display: 2.4 refreshes each, so gaps of 33 and 50 ms
    const s = stats(Array.from({ length: 60 }, (_, i) => (i % 5 === 1 || i % 5 === 3 ? 3 : 2)));
    expect(s.fps).toBeCloseTo(25, 0);
    expect(s.slow50Percent).toBe(40);
    expect(s.slow34Percent).toBe(s.slow50Percent);
  });

  it('reads every frame of a slower surface as slow', () => {
    const s = stats(Array.from({ length: 30 }, (_, i) => (i % 5 < 2 ? 3 : 4)));
    expect(s.slow50Percent).toBe(100);
    expect(s.worstMs).toBe(66.7);
  });

  it('finds a surface as API 34 lists it, and as Android 16 does', () => {
    const api34 = `Background for SurfaceView[dev.app/x]#1
SurfaceView[dev.app/x]#2
SurfaceView[dev.app/x](BLAST)#3
dev.app/x#4
`;
    expect(surfaceLayers(api34, 'dev.app')).toEqual([
      'SurfaceView[dev.app/x]#2',
      'SurfaceView[dev.app/x](BLAST)#3',
    ]);
    const android16 = `RequestedLayerState{Background for ad16944 SurfaceView[dev.app/x]#111505 parentId=111503 relativeParentId=-1}
RequestedLayerState{ad16944 SurfaceView[dev.app/x](BLAST)#111504 parentId=111503 relativeParentId=-1}
RequestedLayerState{ad16944 SurfaceView[dev.app/x]#111503 parentId=111502 relativeParentId=-1}
`;
    expect(surfaceLayers(android16, 'dev.app')).toEqual([
      'ad16944 SurfaceView[dev.app/x](BLAST)#111504',
      'ad16944 SurfaceView[dev.app/x]#111503',
    ]);
  });

  it('takes the layer that holds frames, and reads none when the app shows no surface', async () => {
    const device = (answers: Record<string, string>, frames?: () => string) =>
      ({
        serial: 'emulator-5554',
        readyToMeasure: () => Promise.resolve(),
        shell: (c: string) => {
          if (frames && c.includes('--latency') && c.includes('BLAST'))
            return Promise.resolve(frames());
          const hit = Object.keys(answers).find((k) => c.includes(k));
          return Promise.resolve(hit ? answers[hit] : '');
        },
      }) as unknown as PerfDevice;
    const list =
      'Background for SurfaceView[dev.app/x]#1\nSurfaceView[dev.app/x]#2\nSurfaceView[dev.app/x](BLAST)#3\n';
    const got = await surfaceFrames(
      device({
        '--list': list,
        '(BLAST)#3': latency([2, 2, 2]),
        '[dev.app/x]#2': `${PERIOD}\n0\t0\t0\n`,
      }),
      'dev.app',
    );
    expect(got.value.layer).toBe('SurfaceView[dev.app/x](BLAST)#3');
    expect(got.value.frames).toBe(4);
    expect(got.value.drawing).toBe(false);
    let reads = 0;
    const moving = await surfaceFrames(
      device({ '--list': list, '(BLAST)#3': '' }, () =>
        latency(reads++ ? [2, 2, 2, 2] : [2, 2, 2]),
      ),
      'dev.app',
    );
    expect(moving.value.drawing).toBe(true);
    const none = await surfaceFrames(device({ '--list': 'dev.app/x.Main#4\n' }), 'dev.app');
    expect(none.value.frames).toBe(0);
  });
});

describe('a surface watched while frames are counted', () => {
  const LAYER = 'SurfaceView[dev.app/dev.app.Main](BLAST)#9';
  /** `--latency` holding presents at these refreshes from a start, its last 127 as a phone keeps them. */
  const holding = (at: number[]) =>
    `${PERIOD}\n${at
      .slice(-127)
      .map((n) => {
        const t = 3_000_000_000_000 + n * PERIOD;
        return `${t}\t${t}\t${t}`;
      })
      .join('\n')}\n`;
  /** A device whose surface answers each read with the next of `reads`, the last again after; `left`: those not read. */
  const device = (reads: number[][]) => {
    let n = 0;
    const d = {
      readyToMeasure: () => Promise.resolve(),
      shell: () => Promise.resolve(`${LAYER}\n`),
      shellAlongside: () => Promise.resolve(holding(reads[Math.min(n++, reads.length - 1)] ?? [])),
    } as unknown as PerfDevice;
    return Object.assign(d, { left: () => reads.length - n });
  };
  /** Stopped once every read but the last is made, which the stop makes: however fast this machine reads. */
  const stopped = async (reads: number[][]) => {
    const d = device(reads);
    const watch = await watchSurface(d, 'dev.app');
    await vi.waitFor(() => expect(d.left()).toBeLessThanOrEqual(1), { timeout: 10_000 });
    return watch.stop();
  };
  const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

  it('keeps every present after it began, past the 127 a read holds, and none from before', async () => {
    // 50 presents before, then a frame each refresh for 400, read as it goes
    const s = await stopped([
      range(0, 50),
      range(0, 150),
      range(0, 260),
      range(0, 380),
      range(0, 450),
    ]);
    expect(s).toMatchObject({ layer: LAYER, frames: 400, p95Ms: 16.7, slow34Percent: 0 });
  });

  it('counts no gap over the stretch a late read missed as a slow frame', async () => {
    // the second read came after more than 127 new frames: those between are unread, not slow
    const s = await stopped([range(0, 50), range(0, 100), range(0, 400)]);
    expect(s?.slow34Percent).toBe(0);
    expect(s?.worstMs).toBe(16.7);
  });

  it('takes a frame whose shown time a later read corrects for one frame, not two', async () => {
    const base = 3_000_000_000_000;
    const row = (n: number, late = 0) => {
      const t = base + n * 4 * PERIOD;
      return `${t}\t${t + late}\t${t}`;
    };
    // frames every 4 refreshes; each read's newest is first said 3 ms early, then corrected later
    const reads = [
      [0, 1],
      [0, 1, 2],
      [0, 1, 2, 3],
      [0, 1, 2, 3, 4],
    ].map(
      (ns) =>
        `${PERIOD}\n${ns.map((n, i) => row(n, i === ns.length - 1 ? -3_000_000 : 0)).join('\n')}\n`,
    );
    let n = 0;
    const d = {
      readyToMeasure: () => Promise.resolve(),
      shell: () => Promise.resolve(`${LAYER}\n`),
      shellAlongside: () => Promise.resolve(reads[Math.min(n++, reads.length - 1)] ?? ''),
    } as unknown as PerfDevice;
    const watch = await watchSurface(d, 'dev.app');
    await vi.waitFor(() => expect(n).toBeGreaterThanOrEqual(reads.length - 1), { timeout: 10_000 });
    const s = await watch.stop();
    // frames 2, 3 and 4 since it began, 66.7 ms apart: none a refresh or less after another
    expect(s).toMatchObject({ frames: 3, p50Ms: 66.7, worstMs: 66.7 });
  });

  it('is none where the app shows no surface', async () => {
    const d = { ...device([]), shell: () => Promise.resolve('') } as unknown as PerfDevice;
    await expect((await watchSurface(d, 'dev.app')).stop()).resolves.toBeUndefined();
  });
});
