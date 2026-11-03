import { parseTraceTable } from './trace.js';

export type LaunchPhase = { name: string; ms: number };

/** The part of a kind's name: `Launching - sceneWillConnectTo()` is `scene_will_connect_to`. */
const phaseName = (period: string) =>
  (period.split(' - ').at(-1) ?? period)
    .replace(/\W+$/, '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/\W+/g, '_')
    .toLowerCase();

/** Code before UIKit starts has no period of its own: a SwiftUI app's `init` is here. */
const BEFORE_MAIN = 'static_runtime_initialization';

/**
 * The App Launch template's `life-cycle-period` table: the time of each phase up to the foreground, with repeated
 * periods added up, and the time between periods kept as `main` (after static initializers) or `other`.
 */
export function parseLaunchPhases(xml: string): { phases: LaunchPhase[]; totalMs: number } {
  const rows = parseTraceTable(xml)
    .map((r) => ({
      period: r.period?.value ?? '',
      start: Number(r.start?.value),
      duration: Number(r.duration?.value),
    }))
    .sort((a, b) => a.start - b.start);
  const foreground = rows.findIndex((r) => r.period.startsWith('Foreground'));
  const launching = foreground < 0 ? rows : rows.slice(0, foreground);
  const ns = new Map<string, number>();
  const add = (name: string, value: number) => ns.set(name, (ns.get(name) ?? 0) + value);
  let other = 0;
  launching.forEach((r, i) => {
    const name = phaseName(r.period);
    add(name, r.duration);
    const next = rows[i + 1];
    const between = next ? Math.max(0, next.start - (r.start + r.duration)) : 0;
    if (name === BEFORE_MAIN) add('main', between);
    else other += between;
  });
  const ms = (value: number) => Math.round(value / 1e5) / 10;
  const phases = [...ns].map(([name, value]) => ({ name, ms: ms(value) }));
  if (ms(other) > 0) phases.push({ name: 'other', ms: ms(other) });
  const last = rows[foreground < 0 ? rows.length : foreground];
  const end = last?.start ?? (rows.at(-1)?.start ?? 0) + (rows.at(-1)?.duration ?? 0);
  return { phases, totalMs: rows[0] ? ms(end - rows[0].start) : 0 };
}
