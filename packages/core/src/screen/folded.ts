import { elementLine, screenHeader } from './diff.js';
import type { Rect } from './elements.js';
import type { ScreenElement } from './model.js';

/** Fewer rows than this save nothing over the line their header takes. */
const MIN_RUN = 3;

const within = (a: Rect, b: Rect) =>
  a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

/** `label` holds `part` as whole words: "On" is no part of "Online". */
function holds(label: string, part: string) {
  const at = label.indexOf(part);
  const edge = (c: string | undefined) => !c || !/[\p{L}\p{N}]/u.test(c);
  return at >= 0 && edge(label[at - 1]) && edge(label[at + part.length]);
}

/**
 * The plain elements inside a row that say nothing the row does not: its label holds their text, and a
 * touch on one is a touch on the row.
 */
export function insideRows(list: ScreenElement[]): Set<ScreenElement> {
  const rows = list.filter((e) => e.flags.includes('clickable') && e.label);
  return new Set(
    list.filter(
      (e) =>
        (e.role === 'text' || e.role === 'image') &&
        e.label &&
        e.flags.length === 0 &&
        rows.some((r) => within(e.rect, r.rect) && holds(r.label, e.label)),
    ),
  );
}

/** A row named twice over ("General General") is said once. */
function once(label: string) {
  const middle = (label.length - 1) / 2;
  return label[middle] === ' ' && label.slice(0, middle) === label.slice(middle + 1)
    ? label.slice(0, middle)
    : label;
}

const foldable = (e: ScreenElement) => !!e.label && !e.refContext;
const alike = (a: ScreenElement, b: ScreenElement) =>
  foldable(b) && a.role === b.role && a.x === b.x && a.flags.join() === b.flags.join();

/**
 * The screen as an answer says it: what repeats is folded, and only in this text. The list itself stays
 * whole, so `find`, selectors, refs, diffs and flows still reach every element.
 */
export function renderFolded(
  list: ScreenElement[],
  clean: (s: string) => string = (s) => s,
): string {
  const say = (s: string) => once(clean(s));
  const inside = insideRows(list);
  const rows = list.filter((e) => !inside.has(e));
  const lines = [
    `${screenHeader(list.length)}${inside.size ? `; ${inside.size} inside rows, by find` : ''}`,
  ];
  for (let i = 0, end: number; i < rows.length; i = end) {
    const first = rows[i]!;
    end = i + 1;
    while (foldable(first) && end < rows.length && alike(first, rows[end]!)) end++;
    const run = rows.slice(i, end);
    if (run.length < MIN_RUN) lines.push(...run.map((e) => elementLine(e, say)));
    else
      lines.push(
        `${[first.role, `x=${first.x}`, ...first.flags].join(' ')}: ref "label" y`,
        ...run.map((e) => `${e.ref} ${JSON.stringify(say(e.label))} ${e.y}`),
      );
  }
  return lines.join('\n');
}
