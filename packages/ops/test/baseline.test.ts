import { pairedChange } from '@appdyno/perf';
import { describe, expect, it } from 'vitest';
import { baselineLines, baselineVerdict } from '../src/perf/baseline.js';

const reading = (without: number[], withMs: number[], state = 'status=verify reason=install') => ({
  present: true,
  state,
  applied: state.includes('speed-profile'),
  without,
  with: withMs,
});

const SLOW = [345, 260, 340, 313, 227, 250, 318, 251, 475, 309, 356, 294];
const FAST = [149, 195, 145, 136, 185, 195, 148, 132, 160, 190, 131, 136];

describe('what a profile is worth', () => {
  it('calls the gain of the fixture’s own numbers worth it', () => {
    const { verdict, line } = baselineVerdict(reading(SLOW, FAST));
    expect(verdict).toBe('worth-it');
    expect(line).toMatch(
      /^cold start 311 ms without, 149 ms with: \d+ ms faster \(\d+ %\), p < 0\.0001: worth it$/,
    );
  });

  it('calls nothing inside the floor, or with too few starts', () => {
    expect(baselineVerdict(reading(SLOW, SLOW)).verdict).toBe('no-gain');
    expect(
      baselineVerdict(reading([300, 310, 305, 298, 302], [290, 288, 295, 292, 287])).verdict,
    ).toBe('no-gain');
    expect(baselineVerdict(reading([300, 310], [100, 110])).verdict).toBe('no-gain');
  });

  it('says so when a profile makes a start slower', () => {
    expect(baselineVerdict(reading(FAST, SLOW)).verdict).toBe('slower');
  });

  it('takes no term for how runs move apart: that is what taking turns is for', () => {
    expect(pairedChange(SLOW, FAST, 'ms').floor).toBeCloseTo(0.15 * 311, 0);
  });
});

describe('a profile in words', () => {
  it('reads applied from the status, not the reason a wrong .dm also leaves', () => {
    const wrong = baselineLines(reading([], [], 'status=verify reason=install-dm'));
    expect(wrong[1]).toContain('delivered, and it compiled nothing');
    expect(baselineLines(reading([], [], 'status=speed-profile reason=install-dm'))[1]).toContain(
      'applied',
    );
    expect(baselineLines(reading([], []))[1]).toContain('not applied');
  });

  it('says what a build leaves when none is there', () => {
    expect(baselineLines({ ...reading([], []), present: false })[0]).toContain(
      'none in the APK: assets/dexopt/baseline.prof',
    );
  });
});
