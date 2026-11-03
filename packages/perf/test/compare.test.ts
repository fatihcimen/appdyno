import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addToBaseline,
  compareMetric,
  exitCode,
  latestRuns,
  loadBaseline,
  median,
  rankTest,
  recordsOf,
  reportKey,
  runKeys,
  saveBaseline,
  saveRun,
  shift,
  toJUnit,
  toJson,
  toText,
  type BaselineMetric,
  type DeviceInfo,
  type PerfRecord,
} from '../src/index.js';

/** The same draw every time: a failure here is never flaky. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/** Launch-like samples: a run-wide shift (its load and heat), then each launch's own noise, in whole ms. */
const run = (r: () => number, centre: number, n: number, runSd = 0.04, sd = 0.05) => {
  const level = centre * (1 + runSd * gauss(r));
  return Array.from({ length: n }, () => Math.round(level * (1 + sd * Math.abs(gauss(r)))));
};
const metric = (runs: number[][]): BaselineMetric => ({
  unit: 'ms',
  better: 'lower',
  runs: runs.map((samples) => ({ at: 'x', samples, build: 'release', noise: [] })),
});
const current = (samples: number[]) => ({ samples, build: 'release' as const, noise: [] });

describe('statistics', () => {
  it('rank test: 5 against 5 fully apart is below 0.01, 4 against 4 cannot be', () => {
    expect(rankTest([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])).toBeLessThan(0.01);
    expect(rankTest([1, 2, 3, 4], [6, 7, 8, 9])).toBeGreaterThan(0.01);
    expect(rankTest([5, 5, 5, 5, 5], [5, 5, 5, 5, 5])).toBe(1);
  });

  it('shift: the median pairwise difference', () => {
    expect(shift([100, 110, 120], [200, 210, 220])).toBe(100);
    expect(median([1, 2, 3, 100])).toBe(2.5);
  });
});

describe('compare', () => {
  it('no false alarm: 300 pairs of unchanged runs, each with its own run-wide shift', () => {
    const r = rng(1);
    let alarms = 0;
    for (let i = 0; i < 300; i++) {
      const base = metric([run(r, 500, 8), run(r, 500, 8), run(r, 500, 8)]);
      const c = compareMetric('launch', current(run(r, 500, 8)), base, 'ms', 'lower');
      if (c.verdict === 'regression' || c.verdict === 'improvement') alarms++;
    }
    expect(alarms).toBe(0);
  });

  it('why the floor: the rank test alone alarms on those same unchanged runs', () => {
    const r = rng(1);
    let alarms = 0;
    for (let i = 0; i < 300; i++) if (rankTest(run(r, 500, 24), run(r, 500, 8)) < 0.01) alarms++;
    expect(alarms).toBeGreaterThan(30);
  });

  it('catches +30 % nearly always and +80 % every time', () => {
    const r = rng(2);
    let caught = 0;
    for (let i = 0; i < 300; i++) {
      const base = metric([run(r, 500, 8), run(r, 500, 8), run(r, 500, 8)]);
      const c = compareMetric('launch', current(run(r, 650, 8)), base, 'ms', 'lower');
      if (c.verdict === 'regression') caught++;
      const big = compareMetric('launch', current(run(r, 900, 8)), base, 'ms', 'lower');
      expect(big.verdict, `trial ${i}`).toBe('regression');
    }
    expect(caught).toBeGreaterThan(240);
    const c = compareMetric(
      'launch',
      current(run(r, 900, 8)),
      metric([run(r, 500, 8), run(r, 500, 8), run(r, 500, 8)]),
      'ms',
      'lower',
    );
    expect(c.verdict).toBe('regression');
    expect(c.shift).toBeGreaterThan(300);
  });

  it('says improvement, and respects which way is better', () => {
    const r = rng(3);
    const base = metric([run(r, 500, 8), run(r, 500, 8), run(r, 500, 8)]);
    expect(compareMetric('x', current(run(r, 300, 8)), base, 'ms', 'lower').verdict).toBe(
      'improvement',
    );
    expect(compareMetric('fps', current(run(r, 300, 8)), base, 'ms', 'higher').verdict).toBe(
      'regression',
    );
  });

  it('a change too small to matter is not reported, however significant', () => {
    const r = rng(4);
    const base = metric([[500, 500, 500, 500, 500, 500]]);
    const c = compareMetric('x', current([520, 520, 520, 520, 520, 520]), base, 'ms', 'lower');
    expect(c.verdict).toBe('ok');
    expect(r).toBeDefined();
  });

  it('a baseline of one or two runs cannot alarm: it knows nothing of run-to-run movement', () => {
    const c = compareMetric(
      'x',
      current([900, 901, 902, 903, 904]),
      metric([[500, 501, 502, 503, 504]]),
      'ms',
      'lower',
    );
    expect(c.verdict).toBe('few-samples');
    expect(c.note).toMatch(/1 of the 3 runs/);
  });

  it('too few samples never alarm', () => {
    const c = compareMetric(
      'x',
      current([900, 901, 902]),
      metric([
        [500, 501, 502],
        [500, 501, 502],
        [500, 501, 502],
      ]),
      'ms',
      'lower',
    );
    expect(c.verdict).toBe('few-samples');
    expect(c.note).toMatch(/at least 5/);
  });

  it('a run-to-run movement in the baseline raises the floor', () => {
    const base = metric([
      [400, 400, 400, 400, 400],
      [500, 500, 500, 500, 500],
      [600, 600, 600, 600, 600],
    ]);
    const c = compareMetric('x', current([800, 800, 800, 800, 800]), base, 'ms', 'lower');
    expect(c.floor).toBe(400);
    expect(c.verdict).toBe('ok');
  });

  it('a change under high load warns; a debuggable build does not change the call', () => {
    const base = metric([
      [500, 501, 502, 503, 504],
      [500, 501, 502, 503, 504],
      [500, 501, 502, 503, 504],
    ]);
    const loud = { samples: [900, 901, 902, 903, 904], build: 'release' as const };
    const hot = compareMetric('x', { ...loud, noise: ['hot-device'] }, base, 'ms', 'lower');
    expect(hot.verdict).toBe('noisy');
    expect(hot.note).toMatch(/hot-device/);
    const debug = compareMetric('x', { ...loud, noise: ['debuggable-build'] }, base, 'ms', 'lower');
    expect(debug.verdict).toBe('regression');
  });

  it('refuses unlike builds and compile states', () => {
    const base = metric([
      [500, 501, 502, 503, 504],
      [500, 501, 502, 503, 504],
      [500, 501, 502, 503, 504],
    ]);
    const c = compareMetric(
      'x',
      { samples: [500, 501, 502, 503, 504], build: 'debug', noise: [] },
      base,
      'ms',
      'lower',
    );
    expect(c.verdict).toBe('refused');
    const m = compareMetric(
      'x',
      { samples: [500, 501, 502, 503, 504], build: 'release', compile: 'speed', noise: [] },
      base,
      'ms',
      'lower',
    );
    expect(m.verdict).toBe('refused');
    expect(m.note).toMatch(/compile speed/);
  });
});

const phone: DeviceInfo = {
  serial: 'A',
  platform: 'android',
  model: 'Pixel 9',
  os: '15',
  virtual: false,
};
const context = (samples: number[], run: string, at: string, thermal = 0): PerfRecord[] =>
  recordsOf(
    {
      run,
      app: 'dev.x',
      scenario: 'launch-cold',
      source: 'am start -W',
      raw: '/tmp/raw.txt',
      device: phone,
      build: 'release',
      load: { host: [1, 1, 1], hostCpus: 10 },
      thermal,
      tool: '0.5.0',
      at,
    },
    [{ kind: 'launch.ttid', unit: 'ms', samples }],
  );

describe('store and reports', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'appdyno-perf-'));

  it('a record carries its context and its noise', () => {
    const [r] = context([100, 110, 120], 'r1', '2026-11-03T00:00:00.000Z', 3);
    expect(r).toMatchObject({
      value: 110,
      deviceClass: 'android-physical-Pixel_9-15',
      noise: ['hot-device'],
      spread: { min: 100, max: 120, mad: 10 },
    });
    expect(
      recordsOf(
        {
          run: 'r',
          app: 'a',
          scenario: 's',
          source: '',
          raw: '',
          device: { ...phone, virtual: true },
          build: 'debug',
          load: { host: [30, 1, 1], hostCpus: 10 },
          tool: '',
          at: '',
        },
        [{ kind: 'k', unit: 'ms', samples: [1] }],
      )[0]!.noise,
    ).toEqual(['high-host-load', 'debuggable-build']);
    expect(
      recordsOf(
        {
          run: 'r',
          app: 'a',
          scenario: 's',
          source: '',
          raw: '',
          device: phone,
          build: 'release',
          load: { host: [30, 1, 1], hostCpus: 10 },
          tool: '',
          at: '',
        },
        [{ kind: 'gone', unit: 'ms', samples: [Number.NaN] }],
      ),
    ).toEqual([]);
  });

  it('keeps runs and baselines by key; a gate fails on a regression or a budget', async () => {
    const d = dir();
    const project = dir();
    const a = context([500, 505, 510, 515, 520], 'r1', '2026-11-03T00:00:00.000Z');
    await saveRun(d, a);
    await saveRun(d, context([900, 905, 910, 915, 920], 'r2', '2026-11-03T00:01:00.000Z'));
    const [key] = await runKeys(d, { app: 'dev.x' });
    expect(key).toEqual({
      app: 'dev.x',
      scenario: 'launch-cold',
      deviceClass: 'android-physical-Pixel_9-15',
    });
    const newest = await latestRuns(d, key!);
    expect(newest[0]![0]!.run).toBe('r2');
    expect(await loadBaseline(project, key!)).toBeUndefined();
    await saveBaseline(
      project,
      addToBaseline(key!, addToBaseline(key!, addToBaseline(key!, undefined, a), a), a),
    );
    const baseline = await loadBaseline(project, key!);
    expect(baseline!.metrics['launch.ttid']!.runs).toHaveLength(3);
    expect(addToBaseline(key!, baseline, a).metrics['launch.ttid']!.runs).toHaveLength(4);
    expect(addToBaseline(key!, baseline, a, true).metrics['launch.ttid']!.runs).toHaveLength(1);

    const report = reportKey(key!, newest, baseline, []);
    expect(report.comparisons[0]!.verdict).toBe('regression');
    expect(exitCode([report])).toBe(1);
    expect(toText([report])).toMatch(/regression\s+launch\.ttid: 910 ms against 510/);
    expect(JSON.parse(toJson([report])).failed).toBe(true);
    expect(toJUnit([report])).toContain('<failure message="regression');

    const pass = reportKey(key!, newest, addToBaseline(key!, undefined, newest[0]!), []);
    expect(exitCode([pass])).toBe(0);
    expect(toJUnit([pass])).not.toContain('<failure');

    const over = reportKey(key!, newest, undefined, [{ kind: 'launch.ttid', max: 800 }]);
    expect(over.comparisons[0]!.verdict).toBe('new');
    expect(exitCode([over])).toBe(1);
    expect(toText([over])).toMatch(/over budget launch\.ttid: 910 \(max 800\)/);
    expect(
      exitCode([reportKey(key!, newest, undefined, [{ kind: 'launch.ttid', max: 2000 }])]),
    ).toBe(0);
    expect(
      exitCode([
        reportKey(key!, newest, undefined, [{ kind: 'launch.ttid', max: 1, scenario: 'other' }]),
      ]),
    ).toBe(0);
  });

  it('pools the newest runs of a metric', async () => {
    const d = dir();
    await saveRun(d, context([100, 100], 'r1', '2026-11-03T00:00:00.000Z'));
    await saveRun(d, context([200, 200, 200], 'r2', '2026-11-03T00:01:00.000Z'));
    const [key] = await runKeys(d);
    const r = reportKey(key!, await latestRuns(d, key!, 2), undefined, []);
    expect(r.comparisons[0]!.n.current).toBe(5);
  });
});
