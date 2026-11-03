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
} from '../src/perf-parse.js';

const fx = (name: string) =>
  readFileSync(new URL(`./fixtures/android/${name}`, import.meta.url), 'utf8');

describe('android perf parsers on recorded outputs', () => {
  it('counts a frame with the bit Android 16 sets on ordinary frames, not a window change', () => {
    const rows = parseFramestats(
      `---PROFILEDATA---\nFlags,IntendedVsync,FrameCompleted,\n32,1000000,17000000,\n33,1000000,17000000,\n2,1000000,17000000,\n---PROFILEDATA---\n`,
    );
    expect(rows.map((r) => r.durationMs)).toEqual([16]);
  });

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
      startNs: 851716987249,
    });
  });

  it('reads the rows of every window block, an empty block first', () => {
    const block = (rows: string) =>
      `---PROFILEDATA---\nFlags,IntendedVsync,FrameCompleted,\n${rows}---PROFILEDATA---\n`;
    const text = `${block('')}${block('0,1000000000,1040000000,\n0,2000000000,2010000000,\n1,3000000000,3500000000,\n')}`;
    expect(parseFramestats(text)).toEqual([
      { durationMs: 40, intervalMs: 16.7, startNs: 1e9 },
      { durationMs: 10, intervalMs: 16.7, startNs: 2e9 },
    ]);
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
      appJankPercent: 40,
      bufferStuffing: 1,
      surfaceFlinger: 1,
      p50Ms: 16,
      p95Ms: 45,
      worstMs: 45,
    });
  });
});

describe('profile and frame windows', () => {
  it('reads the simpleperf symbol report, most first', async () => {
    const { parseSimpleperfReport } = await import('../src/perf-parse.js');
    const report = [
      'Cmdline: /system/bin/simpleperf record --app dev.app',
      'Samples: 2997',
      'Overhead  Sample  Symbol',
      '62.10%    1861    dev.appdyno.fixture.CpuActivity.onCreate$lambda$0$lambda$1',
      '20.02%    600     art::interpreter::Execute',
      '5.50%     165     [kernel.kallsyms]',
    ].join('\n');
    expect(parseSimpleperfReport(report)).toEqual([
      {
        percent: 62.1,
        samples: 1861,
        symbol: 'dev.appdyno.fixture.CpuActivity.onCreate$lambda$0$lambda$1',
      },
      { percent: 20.02, samples: 600, symbol: 'art::interpreter::Execute' },
      { percent: 5.5, samples: 165, symbol: '[kernel.kallsyms]' },
    ]);
  });

  it('finds the worst second of frames', async () => {
    const { worstWindow } = await import('../src/perf-parse.js');
    const row = (s: number, ms: number) => ({ startNs: s * 1e6, durationMs: ms, intervalMs: 16.7 });
    // a smooth second, then a second with three missed frames
    const rows = [
      ...Array.from({ length: 60 }, (_, i) => row(i * 16, 12)),
      row(1500, 80),
      row(1600, 90),
      row(1700, 70),
      row(1800, 12),
    ];
    expect(worstWindow(rows)).toMatchObject({ slow: 3 });
  });
});
