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

const failed = (r: KeyReport) => [
  ...r.comparisons.filter((c) => c.verdict === 'regression'),
  ...r.budgets.filter((b) => !b.ok),
];

/** Non-zero when any regression or broken budget is in the reports; a noisy change warns only. */
export const exitCode = (reports: KeyReport[]) => (reports.some((r) => failed(r).length) ? 1 : 0);

const num = (x: number | undefined) => (x === undefined ? '?' : String(Math.round(x * 100) / 100));

const line = (c: Comparison) => {
  const change =
    c.shift === undefined
      ? ''
      : ` ${c.shift >= 0 ? '+' : ''}${num(c.shift)} ${c.unit}${c.percent !== undefined ? ` (${c.percent}%)` : ''}, floor ${num(c.floor)}${c.p !== undefined ? `, p ${c.p}` : ''}`;
  return `${c.verdict.padEnd(11)} ${c.kind}: ${num(c.current)} ${c.unit} against ${num(c.baseline)}${change} [n ${c.n.current}/${c.n.baseline}]${c.note ? `: ${c.note}` : ''}`;
};

export function toText(reports: KeyReport[]): string {
  if (reports.length === 0) return 'no measured runs to compare';
  return reports
    .flatMap((r) => [
      `${r.app} ${r.scenario} on ${r.deviceClass} (run ${r.run}, ${r.at})${r.noise.length ? `; noise: ${r.noise.join(', ')}` : ''}`,
      ...r.comparisons.map((c) => `  ${line(c)}`),
      ...r.budgets.map(
        (b) => `  ${b.ok ? 'ok         ' : 'over budget'} ${b.kind}: ${num(b.value)} (${b.limit})`,
      ),
    ])
    .join('\n');
}

export const toJson = (reports: KeyReport[]) =>
  JSON.stringify({ failed: exitCode(reports) !== 0, reports }, null, 2);

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toJUnit(reports: KeyReport[]): string {
  const suites = reports.map((r) => {
    const name = xml(`${r.app} ${r.scenario} ${r.deviceClass}`);
    const cases = [
      ...r.comparisons.map((c) => {
        const body =
          c.verdict === 'regression'
            ? `<failure message="${xml(line(c))}"/>`
            : c.verdict === 'ok' || c.verdict === 'improvement'
              ? ''
              : `<skipped message="${xml(line(c))}"/>`;
        return `<testcase classname="${name}" name="${xml(c.kind)}">${body}</testcase>`;
      }),
      ...r.budgets.map(
        (b) =>
          `<testcase classname="${name}" name="budget ${xml(b.kind)}">${b.ok ? '' : `<failure message="${xml(`${num(b.value)} over ${b.limit}`)}"/>`}</testcase>`,
      ),
    ];
    return `<testsuite name="${name}" tests="${cases.length}" failures="${failed(r).length}">${cases.join('')}</testsuite>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>${suites.join('')}</testsuites>\n`;
}
