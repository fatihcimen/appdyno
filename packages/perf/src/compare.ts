import type { Build, Noise, PerfRecord, Unit } from './record.js';
import { median, rankTest, shift } from './stats.js';

/** One run's readings of a metric in a baseline. */
export type BaselineRun = {
  at: string;
  samples: number[];
  build: Build;
  compile?: string;
  noise: Noise[];
};

export type BaselineMetric = {
  unit: Unit;
  better: 'lower' | 'higher';
  runs: BaselineRun[];
};

/** A committed reference: keyed by app, scenario and device class. */
export type Baseline = {
  schema: 1;
  app: string;
  scenario: string;
  deviceClass: string;
  metrics: Record<string, BaselineMetric>;
};

export type Verdict =
  /** No change beyond the method's limits. */
  | 'ok'
  | 'regression'
  | 'improvement'
  /** A change was seen but too few samples to call it: not an alarm. */
  | 'few-samples'
  /** A change was seen under high load or a hot device: measure again. */
  | 'noisy'
  /** The two sides are not the same thing (build type, compile state). */
  | 'refused'
  /** Nothing to compare against. */
  | 'new';

export type Comparison = {
  kind: string;
  unit: Unit;
  verdict: Verdict;
  current: number;
  baseline?: number;
  /** The shift from baseline to current (Hodges-Lehmann). */
  shift?: number;
  percent?: number;
  /** The change this metric must exceed to count. */
  floor?: number;
  p?: number;
  n: { current: number; baseline: number };
  note?: string;
};

/** Under this a rank test cannot reach ALPHA: 5 against 5 is at best p = 0.0079, 4 against 4 is 0.029. */
export const MIN_SAMPLES = 5;
export const ALPHA = 0.01;

/**
 * The least change worth reporting. These hold on the unchanged-app runs in docs/perf.md: a run's own median
 * moved up to 12 % on an emulator at any load seen, so a smaller floor would alarm on nothing.
 */
const FLOOR: Record<Unit, { percent: number; absolute: number }> = {
  ms: { percent: 15, absolute: 10 },
  percent: { percent: 25, absolute: 3 },
  kb: { percent: 10, absolute: 2048 },
  bytes: { percent: 10, absolute: 1 << 20 },
  count: { percent: 25, absolute: 1 },
  mah: { percent: 25, absolute: 0.1 },
  ratio: { percent: 25, absolute: 0.05 },
};

const BLOCKING: Noise[] = ['high-host-load', 'high-device-load', 'hot-device'];
const blocks = (noise: Noise[]) => noise.filter((n) => BLOCKING.includes(n));
const pct = (d: number, base: number) =>
  base === 0 ? undefined : Math.round((d / Math.abs(base)) * 1000) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * A change counts when it passes all of three: a rank test (p < ALPHA, current run against every baseline
 * sample), a practical floor by unit, and the baseline's own run-to-run movement. The last is what a rank
 * test on samples cannot see: samples of one run share its load and heat, so two runs of an unchanged app
 * differ "significantly" (docs/perf.md has the rates with and without it).
 */
export function compareMetric(
  kind: string,
  current: { samples: number[]; build: Build; compile?: string; noise: Noise[] },
  base: BaselineMetric | undefined,
  unit: Unit,
  better: 'lower' | 'higher',
): Comparison {
  const value = median(current.samples);
  if (!base?.runs.length)
    return {
      kind,
      unit,
      verdict: 'new',
      current: value,
      n: { current: current.samples.length, baseline: 0 },
    };
  const samples = base.runs.flatMap((r) => r.samples);
  const reference = median(samples);
  const n = { current: current.samples.length, baseline: samples.length };
  const head = { kind, unit, current: value, baseline: reference, n };
  const unlike = base.runs.find(
    (r) => r.build !== current.build || (r.compile ?? '') !== (current.compile ?? ''),
  );
  if (unlike)
    return {
      ...head,
      verdict: 'refused',
      note: `baseline is ${unlike.build}${unlike.compile ? `, compile ${unlike.compile}` : ''}; this run is ${current.build}${current.compile ? `, compile ${current.compile}` : ''}`,
    };
  const moved = shift(samples, current.samples);
  const medians = base.runs.map((r) => median(r.samples));
  const runToRun = Math.max(...medians) - Math.min(...medians);
  const limits = FLOOR[unit];
  const floor = Math.max((Math.abs(reference) * limits.percent) / 100, limits.absolute, runToRun);
  const stats = {
    ...head,
    shift: r3(moved),
    ...(pct(moved, reference) !== undefined && { percent: pct(moved, reference)! }),
    floor: r3(floor),
  };
  if (Math.abs(moved) <= floor) return { ...stats, verdict: 'ok' };
  if (n.current < MIN_SAMPLES || n.baseline < MIN_SAMPLES)
    return {
      ...stats,
      verdict: 'few-samples',
      note: `${n.current} against ${n.baseline} samples: at least ${MIN_SAMPLES} each are needed to call it`,
    };
  const p = rankTest(samples, current.samples);
  if (p >= ALPHA) return { ...stats, p: r3(p), verdict: 'ok' };
  const worse = better === 'lower' ? moved > 0 : moved < 0;
  const loud = [...blocks(current.noise), ...base.runs.flatMap((r) => blocks(r.noise))];
  if (worse && loud.length)
    return {
      ...stats,
      p: r3(p),
      verdict: 'noisy',
      note: `measured with ${[...new Set(loud)].join(', ')}: measure again`,
    };
  return { ...stats, p: r3(p), verdict: worse ? 'regression' : 'improvement' };
}

/** A baseline's metrics with one more run added (or, `replace`, this run only). */
export function addToBaseline(
  key: { app: string; scenario: string; deviceClass: string },
  previous: Baseline | undefined,
  records: PerfRecord[],
  replace = false,
): Baseline {
  const metrics: Record<string, BaselineMetric> = replace ? {} : { ...previous?.metrics };
  for (const r of records) {
    const run: BaselineRun = {
      at: r.at,
      samples: r.samples,
      build: r.build,
      ...(r.compile && { compile: r.compile }),
      noise: r.noise,
    };
    metrics[r.kind] = {
      unit: r.unit,
      better: r.better,
      runs: [...(metrics[r.kind]?.runs ?? []), run],
    };
  }
  return { schema: 1, ...key, metrics };
}

/** Limits a project sets. A rule without app, scenario or device class holds for all. */
export type BudgetRule = {
  kind: string;
  max?: number;
  min?: number;
  app?: string;
  scenario?: string;
  deviceClass?: string;
};

export type BudgetResult = { kind: string; value: number; ok: boolean; limit: string };

export function checkBudgets(records: PerfRecord[], rules: BudgetRule[]): BudgetResult[] {
  return records.flatMap((r) =>
    rules
      .filter(
        (b) =>
          b.kind === r.kind &&
          (b.app ?? r.app) === r.app &&
          (b.scenario ?? r.scenario) === r.scenario &&
          (b.deviceClass ?? r.deviceClass) === r.deviceClass,
      )
      .map((b) => ({
        kind: r.kind,
        value: r.value,
        ok: (b.max === undefined || r.value <= b.max) && (b.min === undefined || r.value >= b.min),
        limit: [b.max !== undefined && `max ${b.max}`, b.min !== undefined && `min ${b.min}`]
          .filter(Boolean)
          .join(', '),
      })),
  );
}
