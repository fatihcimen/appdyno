import type { PerfRecord } from '../record.js';
import { figure, multiples } from './figure.js';
import { deviceLabel, formatValue, when } from './format.js';
import { shareOf, splitBar, type Part } from './split-bar.js';
import { tableView } from './table-view.js';
import { cellKey, nameOf, phaseName, phasesOf, type AppView } from './view.js';

/** More parts than this do not read as one whole: the smallest fold into one. */
const MOST_PARTS = 6;
/** The distinct colors of the categorical order. */
const SLOTS = 8;
const FOLD_SLOT = 0;

/** The largest parts in their recorded order, with the rest folded. */
function partsOf(phases: PerfRecord[], slots: Map<string, number>): Part[] {
  const named = phases.map((p) => {
    const name = phaseName(p.kind);
    if (!slots.has(name)) slots.set(name, slots.size + 1);
    const slot = slots.get(name)!;
    return { name, value: p.value, slot: slot > SLOTS ? FOLD_SLOT : slot };
  });
  if (named.length <= MOST_PARTS) return named;
  const kept = new Set([...named].sort((a, b) => b.value - a.value).slice(0, MOST_PARTS - 1));
  const rest = named.filter((p) => !kept.has(p));
  return [
    ...named.filter((p) => kept.has(p)),
    { name: 'other', value: rest.reduce((a, p) => a + p.value, 0), slot: FOLD_SLOT },
  ];
}

/** A launch's newest phases on each device; a phase keeps its color on all of them. */
export function phaseFigures(v: AppView): string {
  const slots = new Map<string, number>();
  return multiples(
    v.classes.flatMap((cls) => {
      const reading = v.cells.get(cellKey('launch-why', cls));
      const phases = reading ? phasesOf(reading.run) : [];
      if (!reading || phases.length === 0) return [];
      const { unit } = phases[0]!;
      const whole = phases.reduce((a, p) => a + p.value, 0);
      const total = formatValue(whole, unit);
      return [
        figure(
          v,
          cls,
          `${total} in all, ${reading.scenario.key.scenario}, ${when(reading.record.at)}`,
          [],
          splitBar(
            partsOf(phases, slots),
            unit,
            `Launch phases on ${deviceLabel(nameOf(v, cls))}, ${total} in all`,
          ),
          tableView(
            'Table',
            ['Phase', 'Time', 'Share'],
            phases.map((p) => [
              phaseName(p.kind),
              formatValue(p.value, p.unit),
              shareOf(p.value, whole),
            ]),
          ),
        ),
      ];
    }),
  );
}
