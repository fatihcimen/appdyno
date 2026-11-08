import { assert, describe, expect, it } from 'vitest';
import { playDay, ramTier, vitalsCall } from '../src/index.js';

const android = { device: { platform: 'android' as const } };
const says = (kind: string, value: number) => vitalsCall({ kind, value, ...android });

describe("a number against Play's definitions", () => {
  it('counts a session above 50 % of frames over 16 ms, not at it', () => {
    expect(says('frames.slow_percent', 50)?.counts).toBe(false);
    expect(says('frames.slow_percent', 50.1)?.counts).toBe(true);
  });

  it('counts a session above 0.1 % of frames over 700 ms, not at it', () => {
    expect(says('frames.frozen_percent', 0.1)?.counts).toBe(false);
    expect(says('frames.frozen_percent', 0.2)?.counts).toBe(true);
  });

  it('counts a start from its limit, by the state, and says a hot start has two limits', () => {
    expect(says('launch.worst_cold_ms', 4_999)?.counts).toBe(false);
    expect(says('launch.worst_cold_ms', 5_000)?.counts).toBe(true);
    expect(says('launch.worst_warm_ms', 2_000)?.counts).toBe(true);
    expect(says('launch.worst_hot_ms', 1_499)?.counts).toBe(false);
    expect(says('launch.worst_hot_ms', 1_500)?.counts).toBe(true);
    expect(says('launch.worst_hot_ms', 1_500)?.says).toContain('its help page 1 s');
  });

  it('counts any user-perceived ANR', () => {
    expect(says('exits.user_anrs', 0)?.counts).toBe(false);
    expect(says('exits.user_anrs', 1)?.counts).toBe(true);
  });

  it('judges memory by the state and the RAM in its kind, and says one device is no P90', () => {
    const limit = 2.25 * 1024 * 1024;
    expect(says('memory.anon_swap.foreground.8gb_kb', limit)?.counts).toBe(false);
    const over = says('memory.anon_swap.foreground.8gb_kb', limit + 1);
    assert(over);
    expect(over.counts).toBe(true);
    expect(over.says).toContain('the limit 2.25 GB with 8 GB of RAM');
    expect(over.says).toContain('P90');
    expect(says('memory.anon_swap.background.4gb_kb', 1024 * 1024 + 1)?.counts).toBe(true);
    // a cached process has no limit, and a device outside the table none either
    expect(says('memory.anon_swap.cached.8gb_kb', 9e9)).toBeUndefined();
    expect(says('memory.anon_swap.foreground.other_gb_kb', 9e9)).toBeUndefined();
  });

  it('judges bitmaps by the state, and not in the foreground', () => {
    expect(says('memory.bitmap.foreground_kb', 9e9)).toBeUndefined();
    expect(says('memory.bitmap.background_kb', 201 * 1024)?.counts).toBe(true);
    expect(says('memory.bitmap.cached_kb', 201 * 1024)?.counts).toBe(false);
    expect(says('memory.bitmap.cached_kb', 401 * 1024)?.counts).toBe(true);
  });

  it('finds the tier of a device’s RAM, and none outside the table', () => {
    expect(ramTier(7_665)).toBe(8);
    expect(ramTier(3_199)).toBeUndefined();
    expect(ramTier(3_200)).toBe(4);
    expect(ramTier(18_432)).toBeUndefined();
  });

  it('says what this session would do, and never a rate', () => {
    for (const [kind, value] of [
      ['frames.slow_percent', 80],
      ['frames.frozen_percent', 0.5],
      ['launch.worst_cold_ms', 6_000],
      ['exits.user_anrs', 1],
    ] as const) {
      const said = says(kind, value);
      assert(said);
      const words = said.says;
      expect(words).toMatch(/^this session would count as /);
      expect(words).not.toMatch(/\brate\b|0\.47|1\.09|\bpass/);
    }
  });

  it('has nothing to say of another kind or another platform', () => {
    expect(says('frames.jank_percent', 80)).toBeUndefined();
    expect(
      vitalsCall({ kind: 'frames.slow_percent', value: 80, device: { platform: 'ios' } }),
    ).toBeUndefined();
  });

  it('counts a day as Play does, from midnight Pacific', () => {
    expect(playDay('2026-11-04T07:59:00.000Z')).toBe('2026-11-03');
    expect(playDay('2026-11-04T08:01:00.000Z')).toBe('2026-11-04');
  });
});
