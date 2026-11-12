import { esc } from '@appdyno/core';
import { VIRTUAL_IS_RELATIVE } from '../answer-text.js';
import { measureOf, type MeasureId, type PerfRecord } from '../record.js';
import { vitalsCall } from '../vitals.js';
import type { Refusal } from '../store.js';
import { age, formatValue, measureTitle, time, type DeviceName } from './format.js';
import { stepChips } from './journeys.js';
import { chip } from './marks.js';
import {
  cellKey,
  changeText,
  isJourney,
  isPhase,
  limitText,
  loud,
  nameOf,
  phaseName,
  phasesOf,
  rowOf,
  rowsOf,
  stepTimes,
  type AppView,
  type Reading,
} from './view.js';

const verdictChips = ({ record, run, scenario }: Reading) => {
  if (run !== scenario.runs[0]) return [];
  const c = scenario.report.comparisons.find((x) => x.kind === record.kind);
  const broken = scenario.report.budgets.filter((b) => b.kind === record.kind && !b.ok);
  const steps = isJourney(record.kind) ? stepChips(scenario) : [];
  return [
    ...steps,
    ...(c?.verdict === 'regression' ? [chip('critical', `regression ${changeText(c)}`)] : []),
    ...(c?.verdict === 'improvement' ? [chip('good', `improved ${changeText(c)}`)] : []),
    ...(c?.verdict === 'noisy' ? [chip('warning', 'a change under noise: measure again')] : []),
    ...broken.map((b) => chip('critical', `over budget, ${limitText(b, scenario)}`)),
  ];
};

const valueOf = ({ record, run }: Reading) =>
  formatValue(
    isPhase(record.kind) ? phasesOf(run).reduce((a, p) => a + p.value, 0) : record.value,
    record.unit,
  );

const detailOf = ({ record, run }: Reading) => {
  if (isJourney(record.kind)) {
    const steps = stepTimes(run);
    const [first] = steps;
    if (!first) return record.kind;
    const slowest = steps.reduce((a, x) => (x.record.value > a.record.value ? x : a), first);
    return `${steps.length} steps, slowest ${slowest.name} ${formatValue(slowest.record.value, slowest.record.unit)}`;
  }
  if (!isPhase(record.kind)) return record.kind;
  const phases = phasesOf(run);
  const longest = phases.reduce((a, p) => (p.value > a.value ? p : a), record);
  return `${phases.length} phases, longest ${phaseName(longest.kind)} ${formatValue(longest.value, longest.unit)}`;
};

/** What a number is on a device where it is not what the same row is on a phone. */
const ON_A_SIMULATOR: Partial<Record<MeasureId, string>> = {
  frames: 'main-thread pacing, on this Mac',
  frozen: 'main-thread pacing, on this Mac',
  stalls: 'main-thread pacing, on this Mac',
  energy: "this Mac's energy, not a phone's",
};

const meaningOf = ({ device, kind }: PerfRecord) => {
  const row = measureOf(kind);
  return row && device.platform === 'ios' && device.virtual ? ON_A_SIMULATOR[row] : undefined;
};

/** What Play's definitions say of what this run read for this row. */
const vitalsChips = ({ record, run }: Reading) =>
  run
    .filter((x) => rowOf(x.kind) === rowOf(record.kind))
    .flatMap((x) => vitalsCall(x) ?? [])
    .map((c) => chip(c.counts ? 'warning' : 'good', c.says));

const readingCell = (r: Reading, now: number) => {
  const { record, scenario } = r;
  const noise = loud(record.noise);
  const meaning = meaningOf(record);
  const notes = [
    ...verdictChips(r),
    ...vitalsChips(r),
    ...(record.modelled ? [chip('model', 'estimate, from a model')] : []),
    ...(meaning ? [`<div class="m">${esc(meaning)}</div>`] : []),
    ...(noise.length ? [chip('warning', `noise: ${noise.join(', ')}`)] : []),
    ...(record.noise.includes('debuggable-build') ? ['<span class="m">debug build</span>'] : []),
    ...(record.noise.includes('device-state-unread')
      ? ['<span class="m">device state unread</span>']
      : []),
    ...(record.noise.includes('host-load-unread')
      ? ['<span class="m">Mac load unread</span>']
      : []),
  ];
  return `<div class="v">${record.modelled ? '~' : ''}${esc(valueOf(r))}</div><div class="m">${esc(detailOf(r))}, ${esc(scenario.key.scenario)}, ${esc(age(record.at, now))}</div>${notes.join('')}`;
};

const refusedCell = (r: Refusal, now: number) =>
  `${chip('no', 'cannot be read')}<div class="m">${esc(r.reason)}, ${esc(age(r.at, now))}</div>`;

const refusalOf = (v: AppView, row: string, cls: string) =>
  v.refusals.find(
    (r) => r.measure === row && r.deviceClass === cls && (!r.app || !v.app || r.app === v.app),
  );

/** A refusal is the answer only until a reading is newer. */
function cell(v: AppView, row: string, cls: string) {
  const reading = v.cells.get(cellKey(row, cls));
  const refusal = refusalOf(v, row, cls);
  if (refusal && (!reading || time(refusal.at) > time(reading.record.at)))
    return refusedCell(refusal, v.now);
  return reading ? readingCell(reading, v.now) : '<span class="none">not measured yet</span>';
}

const header = (d: DeviceName) =>
  `<th scope="col"><div>${esc(d.name)}</div><div class="m">${esc(d.detail)}</div>${d.virtual ? '<div class="m">relative</div>' : ''}</th>`;

const rowTitle = (row: string) => {
  const title = measureTitle(row);
  return title ? esc(title) : `other<div class="m">${esc(row)}</div>`;
};

/** Said above the table: it is why the columns are not alike, and an app with no phone has no real numbers yet. */
function realDeviceNote(v: AppView) {
  const onAPhone = v.scenarios.some((s) => !nameOf(v, s.key.deviceClass).virtual);
  const noPhone = onAPhone
    ? ''
    : `<div class="card nophone">${chip('warning', `No phone has been measured for ${v.app}.`)}<pre><code>${esc(`appdyno perf survey --app ${v.app} --device <id>`)}</code></pre></div>`;
  return `<p class="note">${esc(VIRTUAL_IS_RELATIVE)}</p>${v.app ? noPhone : ''}`;
}

/** Whether any device has said anything of this row, by a number or a refusal. */
const heardOf = (v: AppView, row: string) =>
  v.classes.some((cls) => v.cells.has(cellKey(row, cls)) || refusalOf(v, row, cls));

/** The page's core: what each device can read of this app, and how it last read. Rows with nothing yet fold into a line. */
export function measuresTable(v: AppView): string {
  const all = rowsOf(v.scenarios);
  const silent = all.filter((row) => !heardOf(v, row));
  const unread = silent.length
    ? `<p class="note unread">These are not measured yet on any device: ${esc(silent.map((r) => measureTitle(r) ?? r).join(', '))}.</p>`
    : '';
  const rows = all
    .filter((row) => heardOf(v, row))
    .map((row) => {
      const cells = v.classes.map(
        (cls) => `<td data-device="${esc(nameOf(v, cls).name)}">${cell(v, row, cls)}</td>`,
      );
      return `<tr><th scope="row">${rowTitle(row)}</th>${cells.join('')}</tr>`;
    });
  if (rows.length === 0) return `${realDeviceNote(v)}${unread}`;
  return `${realDeviceNote(v)}<div class="tw"><table class="matrix" style="--cols:${v.classes.length}"><thead><tr><th scope="col">Measure</th>${v.classes.map((c) => header(nameOf(v, c))).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>${unread}`;
}
