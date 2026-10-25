import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseAmStart,
  parseFrameStats,
  parseFrameTimelineCsv,
  parseFramestats,
  parseMeminfo,
  parseProcStatTicks,
  parseVitals,
} from '../src/android/perf-parse.js';

const fx = (name: string) =>
  readFileSync(new URL(`./fixtures/android/${name}`, import.meta.url), 'utf8');

describe('android perf parsers on recorded outputs', () => {
  it('reads the gfxinfo summary and the per-frame rows', () => {
    const s = parseFrameStats(fx('android-gfxinfo-framestats.txt'));
    expect(s).toMatchObject({
      totalFrames: 144,
      jankyFrames: 9,
      jankyPercent: 6.25,
      p50Ms: 21,
      p99Ms: 150,
      deadlineMissed: 9,
      fewFrames: false,
    });
    expect(s.frames!.count).toBeGreaterThan(50);
    expect(s.frames!.worstMs).toBeGreaterThanOrEqual(s.frames!.p95Ms);
    // the first row: IntendedVsync 851716987249 → FrameCompleted 851744228572 is 27.2 ms at a 16.7 ms interval
    expect(parseFramestats(fx('android-gfxinfo-framestats.txt'))[0]).toEqual({
      durationMs: 27.2,
      intervalMs: 16.7,
    });
  });

  it('counts frozen frames from the histogram buckets from 700 ms on', () => {
    const text =
      'Total frames rendered: 100\nJanky frames: 5 (5.00%)\nHISTOGRAM: 5ms=90 700ms=2 1150ms=1\n';
    expect(parseFrameStats(text)).toMatchObject({ frozenFrames: 3, fewFrames: false });
    expect(() => parseFrameStats('nothing')).toThrow(/no frame summary/);
  });

  it('reads meminfo PSS, heaps and private dirty', () => {
    const m = parseMeminfo(fx('android-meminfo.txt'));
    expect(m.pssKb).toBeGreaterThan(0);
    expect(m.javaHeapKb).toBeGreaterThan(0);
    expect(m.nativeHeapKb).toBeGreaterThan(0);
    expect(m.privateDirtyKb).toBeGreaterThan(0);
  });

  it('reads am start -W', () => {
    expect(parseAmStart(fx('android-am-start-W.txt'))).toEqual({
      totalMs: 609,
      waitMs: 613,
      state: 'COLD',
      status: 'ok',
    });
  });

  it('reads utime and stime past a process name with spaces and parentheses', () => {
    expect(parseProcStatTicks('123 (a b) c) S 1 2 3 4 5 6 7 8 9 10 250 50 0 0')).toBe(300);
  });

  it('reads the device vitals sections', () => {
    const v = parseVitals(
      '==load==\n1.20 0.80 0.50 1/1900 1234\n==pressure==\nsome avg10=12.50 avg60=3.00\n==mem==\nMemTotal: 2000000 kB\nMemFree: 1 kB\nMemAvailable: 900000 kB\n==thermal==\nIsStatusOverride: false\nThermal Status: 0\n==battery==\n  level: 100\n  temperature: 250\n',
    );
    expect(v).toEqual({
      load: [1.2, 0.8, 0.5],
      cpuPressure: 12.5,
      memAvailableKb: 900000,
      memTotalKb: 2000000,
      thermalStatus: 0,
      batteryTempC: 25,
    });
  });

  it('reads the frame timeline query output with its jank types', () => {
    expect(parseFrameTimelineCsv(fx('frame-timeline.csv'))).toEqual({
      frames: 5,
      janky: 3,
      jankyPercent: 60,
      appDeadlineMissed: 2,
      bufferStuffing: 1,
      surfaceFlinger: 1,
      p50Ms: 16,
      p95Ms: 45,
      worstMs: 45,
    });
  });
});
