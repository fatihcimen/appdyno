import { must } from '../must.js';
import { asName, elementLine, onLine, quoted, screenHeader } from './diff.js';
import type { Rect } from './elements.js';
import { cutContext, shownLabel, type ScreenElement } from './model.js';

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
  // an edge counts only where a letter runs on into another: "[" is a part of "[b]"
  if (at < 0 || !(wordEdge(own[0]) || wordEdge(row[at - 1]))) return false;
  return cut
    ? own.startsWith(row.slice(at))
    : wordEdge(own.at(-1)) || wordEdge(label[at + own.length]);
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
 * What says nothing the row does not: a plain element whose text its label holds, a control of the same
 * name at the same place, where a touch on one is a touch on the other, what the app gives twice at one place,
 * and a plain element named by the words of a plain one inside it, which says them where they are.
 * A control elsewhere in the row stays: it may do something else than the row.
 */
export function insideRows(list: ScreenElement[]): Set<ScreenElement> {
  const around = holders(list);
  const parts = toggleParts(list);
  const rows = list.filter(
    (e) => e.label && (clickable(e) || e.role === 'textField') && !around.has(e),
  );
  // a web page's words are plain as any: a link's own text is the link's
  const flagsOf = (e: ScreenElement) => e.flags.filter((f) => f !== 'web').join();
  const plain = (e: ScreenElement) =>
    (e.role === 'text' || e.role === 'image') && flagsOf(e) === '';
  // a twin takes the same box: a box around a text at its centre, with its words, is said by that text
  const sameAs = (e: ScreenElement, r: ScreenElement) =>
    r.x === e.x &&
    r.y === e.y &&
    once(r.label) === once(e.label) &&
    (flagsOf(e) === 'clickable'
      ? clickable(r)
      : r.role === e.role &&
        r.flags.join() === e.flags.join() &&
        within(e.rect, r.rect) &&
        within(r.rect, e.rect));
  const area = (e: ScreenElement) => e.rect.width * e.rect.height;
  // an alert is named by its title
  const namedByInner = (e: ScreenElement) =>
    list.some(
      (t) => t.label === e.label && plain(t) && area(t) < area(e) && within(t.rect, e.rect),
    );
  return new Set(
    list.filter(
      (e, i) =>
        around.has(e) ||
        parts.has(e) ||
        (e.label &&
          ((plain(e) &&
            (rows.some((r) => within(e.rect, r.rect) && holds(r.label, e.label)) ||
              namedByInner(e))) ||
            list.slice(0, i).some((r) => sameAs(e, r)))),
    ),
  );
}

const TOGGLES = new Set(['switch', 'checkbox']);

/**
 * What a named toggle says of its row, as SwiftUI gives one Toggle as four: the switch inside it that a touch on it goes
 * to (an iOS 26 switch stands 2 past the row), a control of its words inside it, and the cell around it named by its
 * words and its state, as "Bold Text 0".
 */
function toggleParts(list: ScreenElement[]): Set<ScreenElement> {
  const area = (e: ScreenElement) => e.rect.width * e.rect.height;
  const centred = (e: ScreenElement, r: ScreenElement) =>
    e.x >= r.rect.x &&
    e.x <= r.rect.x + r.rect.width &&
    e.y >= r.rect.y &&
    e.y <= r.rect.y + r.rect.height;
  const out = new Set<ScreenElement>();
  for (const t of list.filter((e) => TOGGLES.has(e.role) && e.label)) {
    const inner = list.filter((e) => e !== t && centred(e, t) && area(e) * 2 <= area(t));
    const own = inner.filter((e) => e.role === t.role);
    // its words as a control of their own are its label where it holds its own switch: elsewhere they may do more
    for (const e of own.length ? inner : [])
      if (e.role === t.role || (clickable(e) && once(e.label) === once(t.label))) out.add(e);
    // a cell no larger than its toggle is a row with a state of its own beside it
    for (const c of list)
      if (c.role === 'cell' && area(t) < area(c) && within(t.rect, c.rect))
        if (holds(c.label, t.label) && /^\s*\d*\s*$/.test(uncut(c.label).replace(t.label, '')))
          out.add(c);
  }
  return out;
}

/**
 * What only holds what is listed, and says nothing of its own: an element with an id and no words around listed ones,
 * as a view controller's view; a text named by nothing but the words of what it holds, as a grid by its pictures; and
 * a panel that takes a touch, named so around controls of its own, where a touch on its middle is one of theirs.
 */
function holders(list: ScreenElement[]): Set<ScreenElement> {
  const area = (e: ScreenElement) => e.rect.width * e.rect.height;
  const words = (e: ScreenElement) => e.whole ?? e.label;
  return new Set(
    list.filter((e) => {
      const held = list.filter(
        (o) => o !== e && o.label && area(o) < area(e) && within(o.rect, e.rect),
      );
      if (!e.label) return e.role === 'other' && !!e.id && !clickable(e) && held.length > 0;
      const panel = e.role === 'tappable' && held.filter(clickable).length >= 2;
      const text = e.role === 'text' && !clickable(e) && held.length >= 2;
      if (!panel && !text) return false;
      // the longest first: a short name may be a part of a long one
      const rest = held
        .map(words)
        .sort((a, b) => b.length - a.length)
        .reduce((left, w) => left.replaceAll(uncut(w), ''), uncut(words(e)));
      return !/[\p{L}\p{N}]/u.test(rest);
    }),
  );
}

const alike = (a: ScreenElement, b: ScreenElement) =>
  !!b.label &&
  a.role === b.role &&
  a.x === b.x &&
  a.flags.join() === b.flags.join() &&
  // a field that holds something says it on a line of its own
  !a.value &&
  !b.value;

/**
 * The screen as an answer says it: what repeats is folded, and only in this text. The list itself stays
 * whole, so `read_screen` with a selector, selectors, refs, diffs and flows still reach every element.
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
  const context = (e: ScreenElement) =>
    e.refContext && (!e.label || names.indexOf(named(e)) !== names.lastIndexOf(named(e)))
      ? cutContext(clean(e.refContext))
      : undefined;
  const line = ({ refContext: _, ...bare }: ScreenElement, told: string | undefined) =>
    elementLine(told ? { ...bare, refContext: told } : bare, say);
  const lines = [
    `${screenHeader(list.length)}${inside.size ? `; ${inside.size} inside rows, by selector` : ''}`,
  ];
  for (let i = 0, end: number; i < rows.length; i = end) {
    const first = must(rows[i], 'a row');
    end = i + 1;
    while (first.label && end < rows.length && alike(first, must(rows[end], 'a row'))) end++;
    const run = rows.slice(i, end);
    // rows of one context say nothing by it; rows it alone tells apart each keep theirs, in a column of its own
    const told = run.map((e) => context(e));
    const apart = new Set(told).size > 1;
    if (run.length < MIN_RUN) lines.push(...run.map((e, k) => line(e, told[k])));
    else
      lines.push(
        `${[asName(first.role), `x=${first.x}`, ...first.flags].join(' ')}: ref "label" y${apart ? ' — context' : ''}`,
        ...run.map(
          (e, k) =>
            `${e.ref} ${quoted(once(shownLabel(e, clean)))} ${e.y}${apart && told[k] ? ` — ${onLine(told[k])}` : ''}`,
        ),
      );
  }
  return lines.join('\n');
}
