import { answerOf, type GateAnswer } from '../answer.js';
import type { BudgetResult, BudgetRule, Comparison } from '../compare.js';
import {
  JOURNEY_TOTAL,
  journeyStep,
  measureOf,
  MEASURES,
  stepName,
  type Noise,
  type PerfRecord,
} from '../record.js';
import { reportKey, type KeyReport } from '../report.js';
import type { Refusal } from '../store.js';
import { deviceName, formatValue, time, type DeviceName } from './format.js';
import type { DashboardData, KeyRuns } from './load.js';

/** A key with what its newest run says, as `perf compare` would, and why, where `perf why` looked at that very run. */
export type Scenario = KeyRuns & { report: KeyReport; answer: GateAnswer };

export type Reading = { record: PerfRecord; run: PerfRecord[]; scenario: Scenario };

/** What one app's section is drawn from. */
export type AppView = {
  app: string;
  scenarios: Scenario[];
  /** Every device class on the page: the same columns for each app. */
  classes: string[];
  names: Map<string, DeviceName>;
  refusals: Refusal[];
  rules: BudgetRule[];
  now: number;
  /** The newest reading of a row on a device, by `cellKey`. */
  cells: Map<string, Reading>;
};

/** A row of the table: a measure, or a kind no measure answers. */
export const rowOf = (kind: string) => measureOf(kind) ?? kind;

export const cellKey = (row: string, cls: string) => `${row}\n${cls}`;

export const isPhase = (kind: string) => kind.startsWith('launch.phase.');

export const isJourney = (kind: string) => kind.startsWith('journey.');

/** What each step of this run took, in order. */
export const stepTimes = (run: PerfRecord[]) =>
  run.flatMap((r) => {
    const s = journeyStep(r.kind);
    return s?.what === 'ms' ? [{ name: stepName(s.step), record: r }] : [];
  });

/** A step's kinds that the gate calls slower in the newest run of this scenario. */
export const regressedSteps = (s: Scenario) =>
  s.report.comparisons.filter((c) => c.verdict === 'regression' && isJourney(c.kind));

/** A kind of the row that has a chart of its own: a journey's whole, and a step while it stands out. */
export const hasTrend = (s: Scenario, kind: string) =>
  !isJourney(kind) || kind === JOURNEY_TOTAL || regressedSteps(s).some((c) => c.kind === kind);

/** A debuggable build is said beside its number, but it is no reason to measure again. */
export const loud = (noise: Noise[]) => noise.filter((n) => n !== 'debuggable-build');

export function scenariosOf(data: DashboardData, unread: string[]): Scenario[] {
  return data.keys.map((k) => {
    const newest = k.runs.slice(0, 1);
    const against = (baseline: KeyRuns['baseline']) => {
      const report = reportKey(k.key, newest, baseline, data.rules);
      const kept = k.answer?.run === report.run && k.answer;
      return { ...k, report, answer: kept || answerOf(report, newest[0] ?? [], baseline) };
    };
    try {
      return against(k.baseline);
    } catch (e) {
      unread.push(`baseline of ${k.key.scenario}: ${(e as Error).message}`);
      return against(undefined);
    }
  });
}

export function namesOf(data: DashboardData) {
  const models = new Map<string, string>();
  for (const k of data.keys) {
    const model = k.runs[0]?.[0]?.device?.model;
    if (typeof model === 'string') models.set(k.key.deviceClass, model);
  }
  const classes = [
    ...new Set([
      ...data.keys.map((k) => k.key.deviceClass),
      ...data.refusals.map((r) => r.deviceClass),
    ]),
  ].sort();
  return new Map(classes.map((c) => [c, deviceName(c, models.get(c))]));
}

/** A launch counted beside a trace of why it was slow, not one of a measure's own launches. */
const traced = (run: PerfRecord[], row: string) =>
  row === 'launch' && run.some((r) => isPhase(r.kind));

function newestCells(scenarios: Scenario[]) {
  const cells = new Map<string, Reading>();
  for (const scenario of scenarios)
    for (const run of scenario.runs)
      for (const record of run) {
        const row = rowOf(record.kind);
        const key = cellKey(row, scenario.key.deviceClass);
        const held = cells.get(key);
        const [was, is] = [held && traced(held.run, row), traced(run, row)];
        // a run's first record of a row is the one its operation leads with
        if (!held || (was === is ? time(held.record.at) < time(record.at) : was))
          cells.set(key, { record, run, scenario });
      }
  return cells;
}

export function appViewOf(
  app: string,
  all: Scenario[],
  data: DashboardData,
  names: Map<string, DeviceName>,
): AppView {
  const scenarios = all.filter((s) => s.key.app === app);
  return {
    app,
    scenarios,
    classes: [...names.keys()],
    names,
    refusals: data.refusals,
    rules: data.rules,
    now: time(data.now),
    cells: newestCells(scenarios),
  };
}

/** The table's rows: every measure, then the kinds no measure answers. */
export function rowsOf(scenarios: Scenario[]): string[] {
  const kinds = new Set(scenarios.flatMap((s) => s.runs.flat().map((r) => r.kind)));
  const other = [...kinds].filter((k) => !measureOf(k)).sort();
  return [...MEASURES, ...other];
}

export const nameOf = (v: Pick<AppView, 'names'>, cls: string) =>
  v.names.get(cls) ?? deviceName(cls);

export const phasesOf = (run: PerfRecord[]) => run.filter((r) => isPhase(r.kind));

/** A phase's name: what is left of its kind once what is said by its place is taken out. */
export const phaseName = (kind: string) =>
  kind.replace('launch.phase.', '').replace(/_ms$/, '').replaceAll('_', ' ');

/** A change in words: its size, and its share when it has one. */
export const changeText = (c: Comparison) =>
  c.shift === undefined
    ? ''
    : `${c.shift >= 0 ? '+' : '-'}${formatValue(Math.abs(c.shift), c.unit)}${c.percent !== undefined ? ` (${c.percent}%)` : ''}`;

export const againstText = (c: Comparison) =>
  `${formatValue(c.current, c.unit)} against ${c.baseline === undefined ? '?' : formatValue(c.baseline, c.unit)}`;

/** A budget's limit in the unit its value reads in. */
export const limitText = (b: BudgetResult, s: Scenario) => {
  const unit = s.report.comparisons.find((c) => c.kind === b.kind)?.unit;
  return unit ? b.limit.replace(/-?\d+(\.\d+)?/g, (n) => formatValue(Number(n), unit)) : b.limit;
};

/** A broken budget in words. */
export const budgetText = (b: BudgetResult, s: Scenario) => {
  const unit = s.report.comparisons.find((c) => c.kind === b.kind)?.unit;
  return `${unit ? formatValue(b.value, unit) : b.value}, budget ${limitText(b, s)}`;
};
