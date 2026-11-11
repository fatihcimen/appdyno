import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MeasureSource } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { frameVitals } from '../src/perf/vitals.js';
import { DEFAULT_POLICY, ServerContext, ToolError } from '../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { callerOf } from '@appdyno/testing/calls.js';

describe("a session's frames in Play's words", () => {
  it('reads a screen of slow frames as one that would count', () => {
    const { lines, shares } = frameVitals([{ frames: 100, over16: 98, over700: 0 }]);
    expect(shares?.slowPercent).toBe(98);
    expect(lines[0]).toContain('this session would count as slow frames: 98 % of frames over 16');
  });

  it.each([
    // one 800 ms frame in 2,000: 0.05 % does not count
    [2_000, 1, 0.05, false],
    // three in 1,500: 0.2 % does
    [1_500, 3, 0.2, true],
  ])('of %i frames with %i frozen reads %d %%', (frames, over700, percent, counts) => {
    const { lines, shares, metrics } = frameVitals([{ frames, over16: 0, over700 }]);
    expect(shares?.frozenPercent).toBe(percent);
    expect(lines[1]).toContain(counts ? 'would count as frozen' : 'would not count as frozen');
    expect(metrics.find((m) => m.kind === 'frames.frozen_percent')?.samples).toEqual([percent]);
  });

  it('says too few frames under 1,000, and keeps no share', () => {
    const { lines, shares, metrics } = frameVitals([{ frames: 500, over16: 0, over700: 1 }]);
    expect(lines[1]).toContain('too few frames to say of frozen frames (500 of the 1000 it takes)');
    expect(shares?.frozenPercent).toBeUndefined();
    expect(metrics.find((m) => m.kind === 'frames.frozen_percent')?.samples).toEqual([]);
  });

  it('pools rounds for the frozen share, and keeps slow frames round by round', () => {
    const { metrics, shares } = frameVitals([
      { frames: 600, over16: 60, over700: 1 },
      { frames: 600, over16: 120, over700: 1 },
    ]);
    expect(shares?.frozenPercent).toBe(0.17);
    expect(metrics.find((m) => m.kind === 'frames.slow_percent')?.samples).toEqual([10, 20]);
  });

  it('holds frozen frames to the frames there were, on a phone whose summary counts each twice', () => {
    const twice = frameVitals([{ frames: 1_420, over16: 142, over700: 1, rowFrames: 710 }]);
    expect(twice.shares?.frozenPercent).toBeUndefined();
    expect(twice.lines[1]).toContain('too few frames to say of frozen frames (710 of the 1000');
    // the slow share is a ratio of the summary's own, which the doubling leaves alone
    expect(twice.shares?.slowPercent).toBe(10);
    expect(twice.metrics.find((m) => m.kind === 'frames.slow_percent')?.samples).toEqual([10]);
    const many = frameVitals([{ frames: 4_000, over16: 0, over700: 1, rowFrames: 2_000 }]);
    expect(many.shares?.frozenPercent).toBe(0.05);
  });

  it('holds a round of slow frames to the frames there were', () => {
    const few = frameVitals([{ frames: 60, over16: 60, over700: 0, rowFrames: 30 }]);
    expect(few.metrics.find((m) => m.kind === 'frames.slow_percent')?.samples).toEqual([]);
  });

  it('says too few frames for a few frames of slow, and has nothing with no histogram', () => {
    expect(frameVitals([{ frames: 10, over16: 10, over700: 0 }]).lines[0]).toContain(
      'too few frames to say of slow frames (10)',
    );
    expect(frameVitals([])).toEqual({ metrics: [], lines: [] });
  });
});

describe("a snapshot's frozen frames", () => {
  const snapshot = async (frozenFrames: number) => {
    const d = new FakeDevice();
    const { frames } = d.measure;
    Object.defineProperty(d, 'measure', {
      value: {
        ...d.measure,
        frames: async () => {
          const read = await frames();
          const histogram = { frames: 120, over16: 4, over700: frozenFrames };
          return { ...read, value: { ...read.value, frozenFrames, histogram } };
        },
      } satisfies MeasureSource,
    });
    const ctx = new ServerContext(
      DEFAULT_POLICY,
      [
        {
          list: () => Promise.resolve([{ serial: d.serial, state: 'device', ready: true }]),
          handles: () => true,
          open: () => d,
        },
      ],
      {
        device: d.serial,
        app: 'dev.app',
        storage: { measurements: mkdtempSync(join(tmpdir(), 'appdyno-vitals-')) },
      },
    );
    return callerOf(ctx)('perf_snapshot', {});
  };

  it("are said as the summary's, which has no rows behind it here", async () => {
    expect((await snapshot(4)).text).toContain("frozen frames here are the system's summary");
    expect((await snapshot(0)).text).not.toContain('frozen frames here');
  });
});

describe('why a hang was a hang, in an answer', () => {
  const device = (platform: 'android' | 'ios') => {
    const d = new FakeDevice();
    Object.defineProperty(d, 'platform', { value: platform });
    const asked: unknown[] = [];
    Object.defineProperty(d, 'measure', {
      value: {
        ...d.measure,
        symbolFiles: platform === 'ios',
        hangs: (_app, _seconds, _during, symbols) => {
          asked.push(symbols);
          return Promise.resolve({
            value: {
              hangs: 1,
              worstMs: 513,
              totalMs: 513,
              tracePath: '/t.trace',
              causes: [{ ms: 513, kind: 'busy', cpuPercent: 97, function: '0x1004c577b' }],
            },
            raw: '/t.trace',
            at: new Date().toISOString(),
          });
        },
      } satisfies MeasureSource,
    });
    const ctx = new ServerContext(
      DEFAULT_POLICY,
      [
        {
          list: () => Promise.resolve([{ serial: d.serial, state: 'device', ready: true }]),
          handles: () => true,
          open: () => d,
        },
      ],
      { device: d.serial, app: 'dev.app', storage: { measurements: '/tmp/appdyno-hang-test' } },
    );
    return { call: callerOf(ctx), asked };
  };

  it('says busy or blocked, and that an address needs its dSYM', async () => {
    const { call, asked } = device('ios');
    const r = await call('perf_trace', { what: 'hangs', dsym: '/a/Fixture.dSYM' });
    expect(r.text).toContain('513 ms hang: busy, on the CPU 97 % of it, in 0x1004c577b');
    expect(r.text).toContain('`dsym` names it');
    expect(r.data.hangCauses).toHaveLength(1);
    expect(asked).toEqual([{ dsym: '/a/Fixture.dSYM' }]);
  });

  it('refuses a dSYM on Android, by name', async () => {
    const { call } = device('android');
    await expect(call('perf_trace', { what: 'hangs', dsym: '/a/x.dSYM' })).rejects.toThrow(
      ToolError,
    );
  });
});
