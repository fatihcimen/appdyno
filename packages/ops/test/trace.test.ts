import { must } from '@appdyno/core';
import { describe, expect, it, vi } from 'vitest';
import { keptBy } from './helpers.js';

// whether this Mac is loaded right now is no part of these answers
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  loadavg: () => [0, 0, 0],
}));

const at = '2026-11-03T00:00:00.000Z';

const traced = (args: Record<string, unknown>, measures: Record<string, unknown>) =>
  keptBy('perf_trace', args, measures);

const common = {
  id: expect.any(String) as unknown,
  raw: expect.any(String) as unknown,
  virtualDevice: false,
  noise: [],
};
const head = expect.stringMatching(/^measurement pm-\w+$/) as unknown;

describe('perf_trace', () => {
  describe('a hold of the main thread', () => {
    const timeline = (over: Record<string, number>) => ({
      frameTrace: () =>
        Promise.resolve({
          value: {
            kind: 'timeline',
            frames: 50,
            janky: 0,
            jankyPercent: 0,
            appDeadlineMissed: 0,
            appJankPercent: 0,
            bufferStuffing: 0,
            surfaceFlinger: 0,
            p50Ms: 9,
            p95Ms: 16,
            worstMs: 38,
            frozen: 0,
            ...over,
          },
          raw: 'csv',
          at,
          source: 'a timeline tool',
        }),
    });
    const stall = (r: Awaited<ReturnType<typeof traced>>) =>
      must(
        r.kept.find((k) => k.kind === 'stalls.worst_ms'),
        'the worst stall',
      ).value;

    it('that no frame shows is the number kept, and it says where that came from', async () => {
      // what a 1500 ms hold read on an emulator: a longest frame of 38 ms was the wrong answer
      const r = await traced({}, timeline({ heldMs: 1_483 }));
      expect(stall(r)).toBe(1_483);
      expect(r.data.heldMs).toBe(1_483);
      expect(r.data.worstMs).toBe(38);
      expect(r.lines.join('\n')).toContain(`Choreographer's "Skipped frames" line`);
    });

    it('that a long frame shows is no second finding', async () => {
      const r = await traced({}, timeline({ worstMs: 1_100, heldMs: 1_000 }));
      expect(stall(r)).toBe(1_100);
      expect(r.lines.join('\n')).not.toContain('Skipped frames');
    });

    it('that nothing told of leaves the longest frame the number', async () => {
      const r = await traced({}, timeline({}));
      expect(stall(r)).toBe(38);
      expect(r.data.heldMs).toBeUndefined();
    });
  });

  it('a frame timeline', async () => {
    const r = await traced(
      {},
      {
        frameTrace: () =>
          Promise.resolve({
            value: {
              kind: 'timeline',
              frames: 120,
              janky: 5,
              jankyPercent: 10,
              appDeadlineMissed: 4,
              appJankPercent: 8,
              bufferStuffing: 1,
              surfaceFlinger: 0,
              p50Ms: 9,
              p95Ms: 30,
              worstMs: 45,
              frozen: 1,
              stats: { frames: 120, overrunP95Ms: 3, overrunWorstMs: 5, cpuP95Ms: 7 },
              tracePath: '/t.pftrace',
            },
            raw: 'csv',
            at,
            source: 'a timeline tool',
          }),
      },
    );
    expect(r.lines).toEqual([
      head,
      '120 frames; late by the app 4 (8%); any jank 5 (10%: buffer stuffing 1, compositor 0)',
      'frame time p50 9 ms, p95 30 ms, worst 45 ms; frozen frames: 1',
      'overrun p95 3 ms, worst 5 ms; CPU p95 7 ms',
      'trace (perf_query): /t.pftrace',
      expect.stringMatching(/^raw output: /),
    ]);
    expect(r.data).toEqual({
      ...common,
      frames: 120,
      frozen: 1,
      appDeadlineMissed: 4,
      appJankPercent: 8,
      jankyPercent: 10,
      p50Ms: 9,
      p95Ms: 30,
      worstMs: 45,
      tracePath: '/t.pftrace',
    });
    expect(r.kept.map((k) => [k.kind, k.value])).toEqual([
      ['frames.app_jank_percent', 8],
      ['frames.p95_ms', 30],
      ['frames.frozen', 1],
      ['stalls.worst_ms', 45],
      ['frames.overrun_p95_ms', 3],
      ['frames.cpu_p95_ms', 7],
    ]);
    expect(r.kept[0]?.source).toBe('a timeline tool');
  });

  it('a phone’s hitches', async () => {
    const r = await traced(
      {},
      {
        frameTrace: () =>
          Promise.resolve({
            value: {
              kind: 'hitches',
              tracePath: '/h.trace',
              durationMs: 6_000,
              frames: 300,
              hitches: 2,
              hitchMs: 40,
              worstMs: 25,
              frozen: 0,
              stalls: { count: 1, worstMs: 260, totalMs: 260 },
              hitchRatio: 6.6,
              causes: { 'expensive commit': 2 },
            },
            raw: '/h.trace',
            at,
            source: 'a hitch tool',
          }),
      },
    );
    expect(r.lines).toEqual([
      head,
      '300 frames; 2 hitches of the app, 40 ms in all, worst 25 ms; hitch ratio 6.6 ms/s',
      'frozen frames: 0; main thread stalled 1 times, worst 260 ms',
      'likely causes: 2× expensive commit',
      'trace (Instruments): /h.trace',
    ]);
    expect(r.data).toEqual({
      ...common,
      frames: 300,
      hitches: 2,
      hitchMs: 40,
      worstMs: 25,
      frozen: 0,
      stalls: 1,
      hitchRatio: 6.6,
      tracePath: '/h.trace',
    });
    expect(r.kept.map((k) => [k.kind, k.value])).toEqual([
      ['hitches.count', 2],
      ['hitches.ratio', 6.6],
      ['hitches.worst_ms', 25],
      ['frames.frozen', 0],
      ['stalls.worst_ms', 260],
    ]);
    expect(r.kept[0]?.source).toBe('a hitch tool');
  });

  it('a simulator’s probe', async () => {
    const r = await traced(
      { probe: false },
      {
        frameTrace: () =>
          Promise.resolve({
            value: {
              kind: 'probe',
              tracePath: '/p.jsonl',
              durationMs: 5_000,
              frames: 250,
              missed: 5,
              missedPercent: 2,
              p50Ms: 16,
              p95Ms: 20,
              worstMs: 120,
              frozen: 0,
              stalls: { count: 1, worstMs: 120, totalMs: 120 },
              lastInputMsAgo: 300,
              limits: 'pacing of the main thread',
            },
            raw: '/p.jsonl',
            at,
            source: 'a probe',
          }),
      },
    );
    expect(r.lines).toEqual([
      head,
      '250 frames in 5000 ms; 5 missed (2%), 0 frozen; interval p50 16 ms, p95 20 ms, worst 120 ms',
      'stalls over 100 ms: 1, 120 ms in all, worst 120 ms',
      'last touch handled 300 ms before the end',
      'pacing of the main thread',
      'probe output: /p.jsonl',
    ]);
    expect(r.data).toEqual({
      ...common,
      frames: 250,
      p50Ms: 16,
      p95Ms: 20,
      worstMs: 120,
      missed: 5,
      frozen: 0,
      stalls: 1,
      tracePath: '/p.jsonl',
      limits: 'pacing of the main thread',
    });
    expect(r.kept.map((k) => k.kind)).toEqual([
      'probe.missed_percent',
      'probe.p95_ms',
      'probe.stall_worst_ms',
      'frames.frozen',
    ]);
    expect(r.kept[0]?.source).toBe('a probe');
  });

  it('XCTest’s own metrics', async () => {
    const r = await traced(
      { what: 'xct_hitches' },
      {
        xctMetrics: () =>
          Promise.resolve({
            value: { metrics: { ratio: [1, 2, 3] }, resultBundle: '/r.xcresult', note: 'a note' },
            raw: '{}',
            at,
            source: 'a test tool',
          }),
      },
    );
    expect(r.lines).toEqual([head, 'ratio: 1, 2, 3', 'a note', 'result bundle: /r.xcresult']);
    expect(r.data).toEqual({
      ...common,
      metrics: { ratio: [1, 2, 3] },
      tracePath: '/r.xcresult',
    });
    expect(r.kept).toEqual([{ kind: 'xct.ratio', value: 2, source: 'a test tool' }]);
  });

  it('a phone’s hangs', async () => {
    const r = await traced(
      { what: 'hangs' },
      {
        hangs: () =>
          Promise.resolve({
            value: { hangs: 1, worstMs: 500, totalMs: 700, tracePath: '/s.trace' },
            raw: '/s.trace',
            at,
            source: 'a hang tool',
          }),
      },
    );
    expect(r.lines).toEqual([
      head,
      '1 hangs of the main thread (over 250 ms), 700 ms in all, worst 500 ms',
      'trace (Instruments): /s.trace',
    ]);
    expect(r.data).toEqual({
      ...common,
      hangs: 1,
      worstMs: 500,
      tracePath: '/s.trace',
    });
    expect(r.kept).toEqual([
      { kind: 'hangs.count', value: 1, source: 'a hang tool' },
      { kind: 'hangs.worst_ms', value: 500, source: 'a hang tool' },
    ]);
  });

  it('a reading that says nothing of how it was read', async () => {
    const r = await traced({}, {});
    expect(r.kept[0]?.source).toBe('perf_trace');
  });
});
