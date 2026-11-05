import {
  checkBudgets,
  compareMetric,
  type Baseline,
  type BudgetResult,
  type BudgetRule,
  type Comparison,
} from './compare.js';
import type { Noise, PerfRecord } from './record.js';
import { median } from './stats.js';
import type { RunKey } from './store.js';
import { xmlText } from '@appdyno/core';

/** What one key's newest run says against its baseline and the budgets. */
export type KeyReport = RunKey & {
  run: string;
  at: string;
  noise: Noise[];
  comparisons: Comparison[];
  budgets: BudgetResult[];
};

/** The newest `runs` (newest first) of a key against its baseline; runs of a metric are pooled. */
export function reportKey(
  key: RunKey,
  runs: PerfRecord[][],
  baseline: Baseline | undefined,
  rules: BudgetRule[],
): KeyReport {
  const newest = runs[0] ?? [];
  const byKind = new Map<string, PerfRecord[]>();
  for (const r of runs.flat()) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  const pooled = [...byKind.values()].map((rs) => ({
    ...rs[0]!,
    samples: rs.flatMap((r) => r.samples),
    value: median(rs.flatMap((r) => r.samples)),
    noise: [...new Set(rs.flatMap((r) => r.noise))],
  }));
  return {
    ...key,
    run: newest[0]?.run ?? '',
    at: newest[0]?.at ?? '',
    noise: [...new Set(pooled.flatMap((r) => r.noise))],
    comparisons: pooled.map((r) =>
      compareMetric(r.kind, r, baseline?.metrics[r.kind], r.unit, r.better),
    ),
    budgets: checkBudgets(pooled, rules),
  };
}

/** What stops a gate: a change seen with too little to call it, or under noise, is a judgement that never happened. */
const stops = (c: Comparison) =>
  c.verdict === 'regression' || c.verdict === 'few-samples' || c.verdict === 'noisy';

const failed = (r: KeyReport) => [
  ...r.comparisons.filter(stops),
  ...r.budgets.filter((b) => !b.ok),
];

/** Non-zero on a regression, a broken budget or a change the gate could not judge. */
export const exitCode = (reports: KeyReport[]) => (reports.some((r) => failed(r).length) ? 1 : 0);

const shown = (x: number | undefined) =>
  x === undefined ? '?' : String(Math.round(x * 100) / 100);

/** What makes a number something other than the device's own reading, said beside it wherever it goes. */
const marksOf = (c: Comparison) =>
  `${c.modelled ? ' (modelled)' : ''}${c.throughHost ? ' (timed through the host)' : ''}`;

/** One number against its baseline: what every surface says of it. */
export const comparisonLine = (c: Comparison) => {
  const change =
    c.shift === undefined
      ? ''
      : ` ${c.shift >= 0 ? '+' : ''}${shown(c.shift)} ${c.unit}${c.percent !== undefined ? ` (${c.percent}%)` : ''}, floor ${shown(c.floor)}${c.p !== undefined ? `, p ${c.p}` : ''}`;
  return `${c.kind}: ${shown(c.current)} ${c.unit} against ${shown(c.baseline)}${change} [n ${c.n.current}/${c.n.baseline}]${marksOf(c)}${c.note ? `: ${c.note}` : ''}`;
};

const line = (c: Comparison) => `${c.verdict.padEnd(11)} ${comparisonLine(c)}`;

export function toText(reports: KeyReport[]): string {
  if (reports.length === 0) return 'no measured runs to compare';
  const cannot = (verdict: Comparison['verdict'], why: string) => {
    const n = reports.flatMap((r) => r.comparisons).filter((c) => c.verdict === verdict).length;
    return n ? [`the gate could not judge ${n} of these: ${why}`] : [];
  };
  const lines = reports.flatMap((r) => [
    `${r.app} ${r.scenario} on ${r.deviceClass} (run ${r.run}, ${r.at})${r.noise.length ? `; noise: ${r.noise.join(', ')}` : ''}`,
    ...r.comparisons.map((c) => `  ${line(c)}`),
    ...r.budgets.map(
      (b) => `  ${b.ok ? 'ok         ' : 'over budget'} ${b.kind}: ${shown(b.value)} (${b.limit})`,
    ),
  ]);
  return [
    ...lines,
    ...cannot('few-samples', 'this is no pass, measure more'),
    ...cannot('noisy', 'measured under load or noise, this is no pass, measure again'),
  ].join('\n');
}

export const toJson = (reports: KeyReport[]) =>
  JSON.stringify({ failed: exitCode(reports) !== 0, reports }, null, 2);

export function toJUnit(reports: KeyReport[]): string {
  const suites = reports.map((r) => {
    const name = xmlText(`${r.app} ${r.scenario} ${r.deviceClass}`);
    const cases = [
      ...r.comparisons.map((c) => {
        const body = stops(c)
          ? `<failure message="${xmlText(line(c))}"/>`
          : c.verdict === 'ok' || c.verdict === 'improvement'
            ? ''
            : `<skipped message="${xmlText(line(c))}"/>`;
        return `<testcase classname="${name}" name="${xmlText(c.kind)}">${body}</testcase>`;
      }),
      ...r.budgets.map(
        (b) =>
          `<testcase classname="${name}" name="budget ${xmlText(b.kind)}">${b.ok ? '' : `<failure message="${xmlText(`${shown(b.value)} over ${b.limit}`)}"/>`}</testcase>`,
      ),
    ];
    return `<testsuite name="${name}" tests="${cases.length}" failures="${failed(r).length}">${cases.join('')}</testsuite>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>${suites.join('')}</testsuites>\n`;
}
