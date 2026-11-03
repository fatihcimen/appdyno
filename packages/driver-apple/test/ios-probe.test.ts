import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { probeFrames, probeHead, probeSummary, probeWindow } from '../src/probe.js';

// recorded from the fixture's stall screen: a window with one tap of 500 ms, as frameTrace keeps it
const recorded = readFileSync(join(import.meta.dirname, 'fixtures/ios-probe-stall.jsonl'), 'utf8');

const T = 1_000_000;
const frame = (at: number, dt = 16.7) => `{"t":${T + at},"dt":${dt},"v":16.7}`;

describe('the frame probe', () => {
  it('sums up a recorded window: the 500 ms stall, the touch, the rate', () => {
    const times = [...recorded.matchAll(/"t":([\d.]+),"dt"/g)].map((m) => Number(m[1]));
    const from = times[0]! - 1;
    const to = times.at(-1)! + 1;
    const s = probeSummary(recorded, from, to);
    expect(s.stalls.count).toBe(1);
    expect(s.stalls.worstMs).toBeGreaterThan(450);
    expect(s.stalls.worstMs).toBeLessThan(550);
    expect(s.worstMs).toBe(s.stalls.worstMs);
    expect(s.p50Ms).toBeCloseTo(16.7, 0);
    expect(s.frames).toBeGreaterThan(100);
    expect(s.lastInputMsAgo).toBeGreaterThanOrEqual(0);
    expect(s.limits).toMatch(/not the render server or GPU/);
  });

  it('reads the same window as frames, with the limits and the stalls', () => {
    const lines = [frame(10), frame(27), frame(77, 50), frame(1000, 923)].join('\n');
    const f = probeFrames(probeWindow(lines, T, T + 2000), T, T + 2000);
    expect(f).toMatchObject({
      totalFrames: 4,
      jankyFrames: 2,
      jankyPercent: 50,
      frozenFrames: 1,
      fewFrames: true,
      stalls: { count: 1, worstMs: 923, totalMs: 923 },
    });
    expect(f.limits).toBeTruthy();
    expect(probeSummary(lines, T, T + 2000).frozen).toBe(1);
  });

  it('counts a stall still running at the end of the window', () => {
    const lines = [frame(10), frame(27), `{"open":${T + 327},"ms":300}`].join('\n');
    const s = probeSummary(lines, T, T + 527);
    expect(s.stalls).toEqual({ count: 1, worstMs: 500, totalMs: 500 });
    // ended within the window: its own frame has the length, the note of it no more counts
    const ended = [...lines.split('\n'), frame(600, 573)].join('\n');
    expect(probeSummary(ended, T, T + 700).stalls.worstMs).toBe(573);
    expect(probeSummary(ended, T, T + 700).stalls.count).toBe(1);
  });

  it('keeps only the window, and what has no time of its own', () => {
    const text = [
      `{"loaded":"a.b","pid":7,"t":${T}}`,
      frame(10),
      '{"launchMs":123.4}',
      `{"input":${T + 20}}`,
      frame(30),
      `{"reset":${T + 25}}`,
      frame(50),
      `{"input":${T + 60}}`,
    ].join('\n');
    const w = probeWindow(text, T + 25, T + 55);
    expect(w).toContain('"loaded"');
    expect(w).toContain('launchMs');
    expect(w).not.toContain('"input"');
    expect(w).not.toContain('"reset"');
    expect(w.split('\n').filter((l) => l.includes('"dt"'))).toEqual([frame(30), frame(50)]);
  });

  it('reads who wrote the file, the launch and the last reset, a half written line aside', () => {
    const text = `{"loaded":"a.b","pid":7,"t":${T}}\n{"launchMs":123.4}\n{"reset":5}\n{"reset":9}\n{"t":1,"d`;
    expect(probeHead(text)).toEqual({
      pid: 7,
      bundle: 'a.b',
      loadedAt: T,
      launchMs: 123.4,
      resetAt: 9,
    });
    expect(probeHead('')).toEqual({});
    expect(probeSummary('', T, T + 1000)).toMatchObject({ frames: 0, missed: 0, worstMs: 0 });
  });
});
