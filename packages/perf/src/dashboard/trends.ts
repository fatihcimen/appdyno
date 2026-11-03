import { esc } from '@appdyno/core';
import { rulesFor } from '../compare.js';
import type { PerfRecord } from '../record.js';
import { figure, multiples } from './figure.js';
import { deviceLabel, formatValue, inScale, measureTitle, scaleOf, when } from './format.js';
import { lineChart, type LinePoint } from './line-chart.js';
import { SHOWN_RUNS } from './load.js';
import { chip } from './marks.js';
import { phaseFigures } from './phases.js';
import { tableView } from './table-view.js';
import { isPhase, loud, nameOf, rowOf, rowsOf, type AppView, type Scenario } from './view.js';

type Point = LinePoint & { record: PerfRecord };

const pointsOf = (s: Scenario, kind: string): Point[] =>
  s.runs
    .flatMap((run) => run.filter((r) => r.kind === kind))
    .reverse()
    .map((record) => ({
      record,
      at: record.at,
      value: record.value,
      noisy: loud(record.noise).length > 0,
      modelled: record.modelled === true,
    }));

const swatch = (kind: string, text: string) =>
  `<span><span class="key ${kind}"></span>${esc(text)}</span>`;

function trendFigure(v: AppView, s: Scenario, kind: string, points: Point[]) {
  const newest = points.at(-1)!.record;
  const { unit } = newest;
  const c = s.report.comparisons.find((x) => x.kind === kind);
  const { baseline, floor } = c ?? {};
  const banded = baseline !== undefined && floor !== undefined;
  const limits = rulesFor(newest, v.rules)
    .flatMap((b) => [b.max, b.min])
    .filter((x) => x !== undefined);
  const regressed = c?.verdict === 'regression';
  const broken = s.report.budgets.some((b) => b.kind === kind && !b.ok);
  const modelled = points.some((p) => p.modelled);
  const chips = [
    ...(regressed ? [chip('critical', 'regression')] : []),
    ...(broken ? [chip('critical', 'over budget')] : []),
    ...(modelled ? [chip('model', 'estimate')] : []),
  ];
  const notes = [
    banded
      ? swatch('band-key', `baseline ${formatValue(baseline, unit)} ± ${formatValue(floor, unit)}`)
      : `<span>${esc(c?.note ?? 'no baseline yet')}</span>`,
    ...limits.map((l) => swatch('limit-key', `budget ${formatValue(l, unit)}`)),
    ...(points.some((p) => p.noisy) ? [swatch('noisy-key', 'under noise')] : []),
  ];
  const scale = scaleOf(unit, Math.max(...points.map((p) => p.value)));
  const rows = points
    .toReversed()
    .map((p) => [
      when(p.at),
      inScale(p.value, scale),
      [...p.record.noise, ...(p.modelled ? ['estimate, from a model'] : [])].join(', '),
    ]);
  const about = `${kind}, ${s.key.scenario}`;
  return figure(
    v,
    s.key.deviceClass,
    about,
    chips,
    lineChart({
      label: `${about}, ${deviceLabel(nameOf(v, s.key.deviceClass))}`,
      unit,
      points,
      ...(banded && { band: { low: baseline - floor, high: baseline + floor } }),
      limits,
      alert: regressed || broken,
    }),
    `<p class="cap">${notes.join('')}</p>`,
    tableView(
      s.total > SHOWN_RUNS
        ? `Table: newest ${points.length} of ${s.total} runs`
        : `Table: ${points.length} runs`,
      ['Run', 'Value', 'Notes'],
      rows,
    ),
  );
}

/** One small chart per kind, scenario and device, each on its own scale; like kinds side by side. */
function trendRow(v: AppView, row: string) {
  const byKind = new Map<string, string[]>();
  for (const s of v.scenarios)
    for (const kind of new Set(s.runs.flat().map((r) => r.kind))) {
      if (rowOf(kind) !== row || isPhase(kind)) continue;
      const points = pointsOf(s, kind);
      if (points.length < 2) continue;
      byKind.set(kind, [...(byKind.get(kind) ?? []), trendFigure(v, s, kind, points)]);
    }
  return multiples([...byKind.values()].flat());
}

/** What changed over time, a measure at a time; a row with one run so far has nothing to show here. */
export function trendsSection(v: AppView): string {
  const groups = rowsOf(v.scenarios).flatMap((row) => {
    const body = row === 'launch-why' ? phaseFigures(v) : trendRow(v, row);
    return body ? [`<h4>${esc(measureTitle(row) ?? `Other: ${row}`)}</h4>${body}`] : [];
  });
  return `<h3>Trends</h3>${
    groups.length
      ? groups.join('')
      : '<p class="note">One run of each so far: a trend starts with the second.</p>'
  }`;
}
