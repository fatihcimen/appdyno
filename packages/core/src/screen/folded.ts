import { must } from '../must.js';
import { elementLine, screenHeader } from './diff.js';
import type { Rect } from './elements.js';
import { cutContext, type ScreenElement } from './model.js';

/** Fewer rows than this save nothing over the line their header takes. */
const MIN_RUN = 3;

/** How much of a long text, cut short in the row and in what it holds, tells that they are the same. */
const MIN_OVERLAP = 12;

const within = (a: Rect, b: Rect) =>
  a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

const uncut = (s: string) => (s.endsWith('…') ? s.slice(0, -1) : s);

const wordEdge = (c: string | undefined) => !c || !/[\p{L}\p{N}]/u.test(c);

/**
 * `label` holds `part` as whole words: "On" is no part of "Online". A long text is cut short in both, so
 * then what the row has left of it must be how the part starts.
 */
function holds(label: string, part: string) {
  const row = uncut(label);
  const own = uncut(part);
  const cut = own !== part;
  const at = row.indexOf(cut ? own.slice(0, MIN_OVERLAP) : own);
  if (at < 0 || !wordEdge(row[at - 1])) return false;
  return cut ? own.startsWith(row.slice(at)) : wordEdge(label[at + own.length]);
}

/** A row named twice over ("General General") is said once. */
function once(label: string) {
  const middle = (label.length - 1) / 2;
  return label[middle] === ' ' && label.slice(0, middle) === label.slice(middle + 1)
    ? label.slice(0, middle)
    : label;
}

const clickable = (e: ScreenElement) => e.flags.includes('clickable');

/**
 * What says nothing the row does not: a plain element whose text its label holds, and a control of the same
 * name at the same place, where a touch on one is a touch on the other. A control elsewhere in the row stays:
 * it may do something else than the row.
 */
export function insideRows(list: ScreenElement[]): Set<ScreenElement> {
  const rows = list.filter((e) => e.label && (clickable(e) || e.role === 'textField'));
  const plain = (e: ScreenElement) =>
    (e.role === 'text' || e.role === 'image') && e.flags.length === 0;
  const sameAs = (e: ScreenElement, r: ScreenElement) =>
    r.x === e.x && r.y === e.y && clickable(r) && once(r.label) === once(e.label);
  return new Set(
    list.filter(
      (e, i) =>
        e.label &&
        (plain(e)
          ? rows.some((r) => within(e.rect, r.rect) && holds(r.label, e.label))
          : e.flags.join() === 'clickable' && list.slice(0, i).some((r) => sameAs(e, r))),
    ),
  );
}

const alike = (a: ScreenElement, b: ScreenElement) =>
  !!b.label &&
  a.role === b.role &&
  a.x === b.x &&
  a.flags.join() === b.flags.join() &&
  a.refContext === b.refContext;

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
  const named = (e: Pick<ScreenElement, 'role' | 'label'>) => `${e.role} ${e.label}`;
  const names = rows.map(named);
  // a context tells apart what is shown together, and needs few words for that; a nameless element has
  // nothing else to go by. Redacted before it is cut, or part of a secret would stay
  const line = ({ refContext, ...bare }: ScreenElement) =>
    elementLine(
      refContext && (!bare.label || names.indexOf(named(bare)) !== names.lastIndexOf(named(bare)))
        ? { ...bare, refContext: cutContext(clean(refContext)) }
        : bare,
      say,
    );
  const lines = [
    `${screenHeader(list.length)}${inside.size ? `; ${inside.size} inside rows, by find` : ''}`,
  ];
  for (let i = 0, end: number; i < rows.length; i = end) {
    const first = must(rows[i], 'a row');
    end = i + 1;
    while (first.label && end < rows.length && alike(first, must(rows[end], 'a row'))) end++;
    const run = rows.slice(i, end);
    if (run.length < MIN_RUN) lines.push(...run.map((e) => line(e)));
    else
      lines.push(
        `${[first.role, `x=${first.x}`, ...first.flags].join(' ')}: ref "label" y`,
        ...run.map((e) => `${e.ref} ${JSON.stringify(say(e.label))} ${e.y}`),
      );
  }
  return lines.join('\n');
}
