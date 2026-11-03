import type { UiElement } from './elements.js';
import { fold } from './fold.js';
import type { ScreenElement } from './model.js';

/** Names an element by what it shows instead of where it is. `index` picks one of several matches. */
export type Selector = { text?: string; id?: string; role?: string; index?: number };

const bareId = (id: string) => id.replace(/^.*:id\//, '');

/** The elements a selector names; where some match the text exactly, only those. */
export function selectIn(list: ScreenElement[], sel: Selector): ScreenElement[] {
  const w = sel.text && fold(sel.text);
  const role = sel.role && fold(sel.role);
  const id = sel.id && bareId(sel.id);
  const hits = list.filter(
    (e) =>
      (!w || fold(e.label).includes(w)) && (!id || e.id === id) && (!role || fold(e.role) === role),
  );
  const exact = w ? hits.filter((e) => fold(e.label) === w) : hits;
  return exact.length > 0 ? exact : hits;
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
