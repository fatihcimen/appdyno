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
const OTHER = 'other';

/** A name's color where it has one and no other part here took it; else one no name has; else any free here. */
function slotOf(name: string, slots: Map<string, number>, taken: Set<number>) {
  const free = Array.from({ length: SLOTS }, (_, i) => i + 1).filter((s) => !taken.has(s));
  const given = new Set(slots.values());
  const held = slots.get(name);
  const slot =
    held !== undefined && !taken.has(held) ? held : (free.find((s) => !given.has(s)) ?? free[0]!);
  if (held === undefined) slots.set(name, slot);
  taken.add(slot);
  return slot;
}

/** The largest parts in their recorded order, each its own color, with the rest and any phase called other folded. */
export function partsOf(
  named: { name: string; value: number }[],
  slots: Map<string, number>,
): Part[] {
  const own = named.filter((p) => p.name !== OTHER);
  const room =
    own.length === named.length && named.length <= MOST_PARTS ? MOST_PARTS : MOST_PARTS - 1;
  const kept = new Set([...own].sort((a, b) => b.value - a.value).slice(0, room));
  const rest = named.filter((p) => !kept.has(p));
  const taken = new Set<number>();
  return [
    ...named.filter((p) => kept.has(p)).map((p) => ({ ...p, slot: slotOf(p.name, slots, taken) })),
    ...(rest.length
      ? [{ name: OTHER, value: rest.reduce((a, p) => a + p.value, 0), slot: FOLD_SLOT }]
      : []),
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
            partsOf(
              phases.map((p) => ({ name: phaseName(p.kind), value: p.value })),
              slots,
            ),
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
