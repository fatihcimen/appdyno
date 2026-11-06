import { describe, expect, it, vi } from 'vitest';
import { keptBy } from './helpers.js';

// whether this Mac is loaded right now is no part of these answers
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  loadavg: () => [0, 0, 0],
}));

const at = '2026-11-03T00:00:00.000Z';

describe('a round of a scroll', () => {
  const drawn = (totalFrames: number) => ({
    frames: async () => ({
      value: {
        totalFrames,
        jankyFrames: 0,
        jankyPercent: 0,
        frozenFrames: 0,
        fewFrames: false,
        p95Ms: 18,
      },
      raw: '',
      at,
    }),
  });

  it('with frames enough keeps its share of jank and its frame time', async () => {
    const { kept } = await keptBy('perf_scroll', { swipes: 1, repeats: 2 }, drawn(120));
    expect(kept.map((k) => k.kind)).toContain('frames.jank_percent');
    expect(kept.find((k) => k.kind === 'frames.p95_ms')!.value).toBe(18);
  });

  it('with too few keeps neither, as a p95 of five frames is one frame', async () => {
    const { kept } = await keptBy('perf_scroll', { swipes: 1, repeats: 2 }, drawn(5));
    expect(kept.map((k) => k.kind)).not.toContain('frames.jank_percent');
    expect(kept.map((k) => k.kind)).not.toContain('frames.p95_ms');
  });
});
