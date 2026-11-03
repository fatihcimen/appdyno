import { esc } from '@appdyno/core';
import type { Unit } from '../record.js';
import { formatValue } from './format.js';
import { tooltip } from './marks.js';

/** `slot`: the part's color, 1 to 8, or 0 for the fold of what does not fit. */
export type Part = { name: string; value: number; slot: number };

const W = 320;
const H = 28;
const GAP = 2;
const CHAR = 6.5;
const PADDING = 12;

export const shareOf = (value: number, whole: number) => `${Math.round((value / whole) * 100)}%`;

/** One whole split into blocks, with its legend: a block too narrow for its share prints none. */
export function splitBar(parts: Part[], unit: Unit, label: string): string {
  const shown = parts.filter((p) => p.value > 0);
  const room = W - GAP * (shown.length - 1);
  const whole = shown.reduce((a, p) => a + p.value, 0);
  let x = 0;
  const blocks = shown.map((p) => {
    const w = (p.value / whole) * room;
    const text = shareOf(p.value, whole);
    const inside =
      w >= text.length * CHAR + PADDING
        ? `<text class="on on${p.slot}" x="${x + 6}" y="${H / 2 + 4}">${text}</text>`
        : '';
    const block = `<g class="pt"><rect class="seg s${p.slot}" x="${x}" width="${w}" height="${H}" rx="4"/>${inside}${tooltip(x + w / 2, H + 4, [formatValue(p.value, unit), p.name.slice(0, 40), text], W)}</g>`;
    x += w + GAP;
    return block;
  });
  const legend = shown.map((p) => `<li><span class="key s${p.slot}"></span>${esc(p.name)}</li>`);
  return `<svg class="split" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${blocks.join('')}</svg><ul class="legend">${legend.join('')}</ul>`;
}
