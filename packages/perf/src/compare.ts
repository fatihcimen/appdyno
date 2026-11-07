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
  /** An estimate from a model: stays marked wherever the number goes. */
  modelled?: boolean;
  /** Timed on this Mac and not on the device: stays marked wherever the number goes. */
  throughHost?: boolean;
};

/** Under this a rank test cannot reach ALPHA: 5 against 5 is at best p = 0.0079, 4 against 4 is 0.029. */
export const MIN_SAMPLES = 5;
export const ALPHA = 0.01;
/** Fewer baseline runs say nothing of how far a run moves by itself. */
export const MIN_BASELINE_RUNS = 3;
/**
 * How many standard deviations of the baseline's run medians a change must exceed. In simulation (runs moving
 * 6 % by themselves, 3 to 8 baseline runs) the range of the medians gave 1.5-3 % false alarms, 4 sd under 1 %.
 */
export const RUN_SDS = 4;

/**
 * The least change worth reporting, whatever the baseline's runs say: a difference of medians over 10 % alone
 * alarmed on 25 of 72 pairs of unchanged runs on a loaded simulator (docs/reference/perf.md). A count's is under 1, as a move of
 * one is the smallest there is: at 1 a rise from none was `ok` on 400 of 400 simulated runs, and a crash on every run
 * passed (scripts/perf-floor-sim.mjs).
 */
export const FLOOR: Record<Unit, { percent: number; absolute: number }> = {
  ms: { percent: 15, absolute: 10 },
  percent: { percent: 25, absolute: 3 },
  kb: { percent: 10, absolute: 2048 },
  bytes: { percent: 10, absolute: 1 << 20 },
  count: { percent: 25, absolute: 0.5 },
  mah: { percent: 25, absolute: 0.1 },
  mj: { percent: 25, absolute: 1 },
  ratio: { percent: 25, absolute: 0.05 },
};

const BLOCKING: Noise[] = ['high-host-load', 'high-device-load', 'hot-device', 'mirrored'];
const blocks = (noise: Noise[]) => noise.filter((n) => BLOCKING.includes(n));
const percentChange = (d: number, base: number) =>
  base === 0 ? undefined : Math.round((d / Math.abs(base)) * 1000) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * A change counts when it passes all of three: a rank test (p < ALPHA, current run against every baseline
 * sample), a practical floor by unit, and the baseline's own run-to-run movement. The last is what a rank
 * test on samples cannot see: samples of one run share its load and heat, so two runs of an unchanged app
 * differ "significantly" (docs/reference/perf.md has the rates with and without it).
 */
export function compareMetric(
  kind: string,
  current: {
    samples: number[];
    build: Build;
    compile?: string;
    noise: Noise[];
    modelled?: boolean;
    throughHost?: boolean;
    /** What a pool of runs was built as: more than one, and its median is of no build. */
    builds?: string[];
  },
  base: BaselineMetric | undefined,
  unit: Unit,
  better: 'lower' | 'higher',
): Comparison {
  const value = median(current.samples);
  const marks = {
    ...(current.modelled && { modelled: true }),
    ...(current.throughHost && { throughHost: true }),
  };
  if (current.builds && current.builds.length > 1)
    return {
      kind,
      unit,
      verdict: 'refused',
      current: value,
      n: { current: current.samples.length, baseline: 0 },
      note: `these runs are of more than one build, ${current.builds.join(' and ')}`,
      ...marks,
    };
  if (!base?.runs.length)
    return {
      kind,
      unit,
      verdict: 'new',
      current: value,
      n: { current: current.samples.length, baseline: 0 },
      ...marks,
    };
  const samples = base.runs.flatMap((r) => r.samples);
  const reference = median(samples);
  const n = { current: current.samples.length, baseline: samples.length };
  const head = { kind, unit, current: value, baseline: reference, n, ...marks };
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
  const mean = medians.reduce((a, b) => a + b, 0) / medians.length;
  const runToRun =
    medians.length < 2
      ? 0
      : RUN_SDS *
        Math.sqrt(medians.reduce((a, b) => a + (b - mean) ** 2, 0) / (medians.length - 1));
  const limits = FLOOR[unit];
  const floor = Math.max((Math.abs(reference) * limits.percent) / 100, limits.absolute, runToRun);
  const stats = {
    ...head,
    shift: r3(moved),
    ...(percentChange(moved, reference) !== undefined && {
      percent: percentChange(moved, reference)!,
    }),
    floor: r3(floor),
  };
  if (Math.abs(moved) <= floor) return { ...stats, verdict: 'ok' };
  if (base.runs.length < MIN_BASELINE_RUNS)
    return {
      ...stats,
      verdict: 'few-samples',
      note: `the baseline has ${base.runs.length} of the ${MIN_BASELINE_RUNS} runs needed to call it: run-to-run movement is unknown`,
    };
  if (n.current < MIN_SAMPLES || n.baseline < MIN_SAMPLES)
    return {
      ...stats,
      verdict: 'few-samples',
      note: `${n.current} against ${n.baseline} samples: at least ${MIN_SAMPLES} each are needed to call it`,
    };
  const p = rankTest(samples, current.samples);
  if (p >= ALPHA) return { ...stats, p: Math.round(p * 1e5) / 1e5, verdict: 'ok' };
  const worse = better === 'lower' ? moved > 0 : moved < 0;
  const loud = [...blocks(current.noise), ...base.runs.flatMap((r) => blocks(r.noise))];
  if (worse && loud.length)
    return {
      ...stats,
      p: Math.round(p * 1e5) / 1e5,
      verdict: 'noisy',
      note: `measured with ${[...new Set(loud)].join(', ')}: measure again`,
    };
  return { ...stats, p: Math.round(p * 1e5) / 1e5, verdict: worse ? 'regression' : 'improvement' };
}

/**
 * Two conditions measured in turns: a run's own drift falls on both, so what is left to call is the floor and
 * the rank test, and no term for how runs move apart.
 */
export function pairedChange(before: number[], after: number[], unit: Unit) {
  const reference = median(before);
  const moved = shift(before, after);
  const limits = FLOOR[unit];
  const floor = Math.max((Math.abs(reference) * limits.percent) / 100, limits.absolute);
  const enough = before.length >= MIN_SAMPLES && after.length >= MIN_SAMPLES;
  const p = enough ? rankTest(before, after) : 1;
  return {
    before: reference,
    after: median(after),
    moved,
    floor,
    p,
    called: Math.abs(moved) > floor && p < ALPHA,
  };
}

/**
 * A baseline's metrics with one more run added (or, `replace`, this run only). A run already there is not added
 * again: it would meet the count of runs with no movement between them, which that count is there to measure.
 */
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
    const held = metrics[r.kind]?.runs ?? [];
    if (held.some((x) => x.at === r.at)) continue;
    metrics[r.kind] = { unit: r.unit, better: r.better, runs: [...held, run] };
  }
  return { schema: 1, ...key, metrics };
}

/** How many runs a baseline holds: of the metric that has most. */
export const runsIn = (b: Baseline | undefined) =>
  Math.max(0, ...Object.values(b?.metrics ?? {}).map((m) => m.runs.length));

/**
 * The most samples of a kind every run of a baseline has: under that a comparison can call nothing. A launch has a kind
 * of few beside its times, and that kind says so for itself.
 */
export const mostSamples = (b: Baseline | undefined) => {
  const runs = runsIn(b);
  return Math.max(
    0,
    ...Object.values(b?.metrics ?? {})
      .filter((m) => m.runs.length >= runs)
      .map((m) => m.runs.reduce((all, r) => all + r.samples.length, 0)),
  );
};

/**
 * What every run of a baseline measured and this one did not, as a judgement that never happened: a screen that stops
 * drawing keeps no frames, and a gate that looked only at what a run holds would call that clear. A kind some of its
 * runs lack comes and goes by itself, and says nothing here.
 */
export function unmeasured(baseline: Baseline | undefined, held: string[]): Comparison[] {
  const runs = runsIn(baseline);
  if (!baseline || runs < MIN_BASELINE_RUNS) return [];
  return Object.entries(baseline.metrics).flatMap(([kind, { unit, runs: of }]) => {
    if (of.length < runs || held.includes(kind)) return [];
    const samples = of.flatMap((r) => r.samples);
    return [
      {
        kind,
        unit,
        verdict: 'few-samples' as const,
        current: Number.NaN,
        baseline: median(samples),
        n: { current: 0, baseline: samples.length },
        note: 'every run of the baseline has it, and this one does not',
      },
    ];
  });
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

/** The rules that hold for a record. */
export const rulesFor = (
  r: Pick<PerfRecord, 'kind' | 'app' | 'scenario' | 'deviceClass'>,
  rules: BudgetRule[],
) =>
  rules.filter(
    (b) =>
      b.kind === r.kind &&
      (b.app ?? r.app) === r.app &&
      (b.scenario ?? r.scenario) === r.scenario &&
      (b.deviceClass ?? r.deviceClass) === r.deviceClass,
  );

export function checkBudgets(records: PerfRecord[], rules: BudgetRule[]): BudgetResult[] {
  return records.flatMap((r) =>
    rulesFor(r, rules).map((b) => ({
      kind: r.kind,
      value: r.value,
      ok: (b.max === undefined || r.value <= b.max) && (b.min === undefined || r.value >= b.min),
      limit: [b.max !== undefined && `max ${b.max}`, b.min !== undefined && `min ${b.min}`]
        .filter(Boolean)
        .join(', '),
    })),
  );
}
