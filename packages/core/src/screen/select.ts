import type { UiElement } from './elements.js';
import { fold } from './fold.js';
import type { ScreenElement } from './model.js';

/** Names an element by what it shows instead of where it is. `index` picks one of several matches. */
export type Selector = { text?: string; id?: string; role?: string; index?: number };

const bareId = (id: string) => id.replace(/^.*:id\//, '');

/** Text as a selector compares it: folded, a run of spaces as one, as a text may hold two where one is typed. */
const words = (s: string) => fold(s).replace(/\s+/g, ' ');

/** What a selector's text is matched against: the whole words, and the label cut short as a flow may have kept it. */
const textsOf = (e: ScreenElement) => [e.label, ...(e.whole ? [e.whole] : [])].map(words);

/**
 * The elements a selector names; where some match the text exactly, only those, else those whose label shows it: a
 * panel named by every row inside it holds a row's words past its cut, and came first, where the row was meant.
 */
export function selectIn(list: ScreenElement[], sel: Selector): ScreenElement[] {
  const w = sel.text && words(sel.text);
  const role = sel.role && fold(sel.role);
  const id = sel.id && bareId(sel.id);
  const hits = list.filter(
    (e) =>
      (!w || textsOf(e).some((t) => t.includes(w))) &&
      (!id || e.id === id) &&
      (!role || fold(e.role) === role),
  );
  if (!w) return hits;
  const exact = hits.filter((e) => textsOf(e).includes(w));
  if (exact.length > 0) return exact;
  const shown = hits.filter((e) => words(e.label).includes(w));
  return shown.length > 0 ? shown : hits;
}

/** Longer than this, a text is a paragraph's. */
const PARAGRAPH = 40;

/**
 * Whether a selector's text named `e` by only a part of a paragraph, as "Home" names "it is home to 18%": nothing on the
 * screen read the text alone, or that would have been the match, and a name meant may be elsewhere.
 */
export function inPart(e: ScreenElement, sel: Selector): boolean {
  const w = sel.text && words(sel.text);
  return !!w && Array.from(e.whole ?? e.label).length > PARAGRAPH && !textsOf(e).includes(w);
}

const pairs = (s: string) => {
  const f = fold(s);
  return new Set(Array.from(f, (c, i) => c + (f[i + 1] ?? '')));
};

/** The elements most like the wanted text (shared letter pairs), for a refusal to offer. */
export function nearest(list: ScreenElement[], want: string | undefined, n = 5): ScreenElement[] {
  const named = list.filter((e) => e.label || e.id);
  if (!want) return named.slice(0, n);
  const a = pairs(want);
  const like = (name: string) => {
    const b = pairs(name);
    return ([...a].filter((p) => b.has(p)).length * 2) / (a.size + b.size || 1);
  };
  const score = (e: ScreenElement) => Math.max(like(e.label), like(e.id ?? ''));
  return named
    .map((e) => ({ e, s: score(e) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, n)
    .map((x) => x.e);
}

/** What `find` reports and `assert` checks of an element, beyond its place on the list. */
export type Attributes = {
  /** The whole text (a list's label is cut short). */
  text: string;
  enabled: boolean;
  checked: boolean;
  focused: boolean;
  /** What a field, slider or switch holds. */
  value?: string;
  bounds: { x: number; y: number; w: number; h: number };
};

export function attributesOf(elements: UiElement[], e: ScreenElement): Attributes {
  const el = elements.find((x) => x.ref === e.ref);
  const holds = /textField|slider|switch|checkbox|radio/.test(e.role);
  return {
    text: el?.text || el?.label || e.label,
    enabled: el?.enabled !== false,
    checked: !!el?.checked,
    focused: !!el?.focused,
    ...(holds && el?.text && !el.password && { value: el.text }),
    bounds: { x: e.rect.x, y: e.rect.y, w: e.rect.width, h: e.rect.height },
  };
}
