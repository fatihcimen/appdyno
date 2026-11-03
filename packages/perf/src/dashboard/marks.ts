import { esc } from '@appdyno/core';

/** Reserved for what the color means; every use comes with an icon and a label, through `chip`. */
export type Status = 'good' | 'warning' | 'critical';
type Icon = Status | 'model' | 'no';

/** Shapes differ as well as colors, so that a status never rests on color alone. */
export const ICONS = `<svg class="defs" aria-hidden="true">
<symbol id="critical" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></symbol>
<symbol id="warning" viewBox="0 0 16 16"><path d="M8 1.5 15.2 14.5H.8Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/><path d="M8 6v4M8 12.2v.1" stroke="#0b0b0b" stroke-width="1.7" stroke-linecap="round"/></symbol>
<symbol id="good" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.6 8.3l2.3 2.3 4.5-4.8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="model" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.8 9.2c1-1.6 2.2-1.6 3.2-.7s2.2.9 3.2-.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></symbol>
<symbol id="no" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.8 12.2l8.4-8.4" stroke="currentColor" stroke-width="1.5"/></symbol>
</svg>`;

export const icon = (name: Icon) =>
  `<svg class="i ${name}" aria-hidden="true"><use href="#${name}"/></svg>`;

export const chip = (name: Icon, label: string) =>
  `<span class="chip">${icon(name)}<span>${esc(label)}</span></span>`;

const CHAR = 6.2;
const LINE = 14;

/**
 * A tooltip shown by CSS while its group is hovered, the first line being the value. It sits beside `x`, on the side
 * with room in a drawing `width` wide.
 */
export function tooltip(x: number, y: number, lines: string[], width: number) {
  const w = Math.max(...lines.map((l) => l.length)) * CHAR + 16;
  const left = x + 8 + w > width ? Math.max(0, x - 8 - w) : x + 8;
  const text = lines.map(
    (l, i) =>
      `<text class="${i === 0 ? 'tv' : 'tl'}" x="${left + 8}" y="${y + 15 + i * LINE}">${esc(l)}</text>`,
  );
  return `<g class="tip"><rect x="${left}" y="${y}" width="${w}" height="${lines.length * LINE + 8}" rx="4"/>${text.join('')}</g>`;
}
