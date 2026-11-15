import type { Point } from '@appdyno/protocol';
import type { Rect, UiElement } from './elements.js';
import { bare, type ScreenElement } from './model.js';

/** `a` lies wholly inside `b`. */
const within = (a: Rect, b: Rect) =>
  a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

/**
 * The one element a selector's matches name, with no index: a control and its own text inside it, with the same words
 * (an Android row), are one target, and so are a web link and its own text, which take the same box, where the one a
 * touch acts on is the target. With an index, the match at it. None where several stand apart, or the index is past
 * the last.
 */
export function oneOf(hits: ScreenElement[], index?: number): ScreenElement | undefined {
  if (index !== undefined) return hits[index];
  const inside = (a: ScreenElement, b: ScreenElement) => a !== b && within(a.rect, b.rect);
  const boxed = new Map<string, ScreenElement>();
  for (const e of hits) {
    const box = `${e.rect.x},${e.rect.y},${e.rect.width},${e.rect.height}`;
    const had = boxed.get(box);
    if (!had || (!had.flags.includes('clickable') && e.flags.includes('clickable')))
      boxed.set(box, e);
  }
  const placed = [...boxed.values()];
  const outer = placed.filter((a) => !placed.some((b) => inside(a, b)));
  return outer.length === 1 ? outer[0] : undefined;
}

/**
 * Where a touch on `e` lands: its middle, but on a web element over two lines, as a link that wraps, its first line's
 * end, where the middle of its box is the text between the lines. A line is as tall as most of the page's elements.
 */
export function landing(e: ScreenElement, list: ScreenElement[]): Point {
  if (!e.flags.includes('web')) return { x: e.x, y: e.y };
  const heights = new Map<number, number>();
  for (const w of list)
    if (w.flags.includes('web') && w.label && w.rect.height > 0)
      heights.set(w.rect.height, (heights.get(w.rect.height) ?? 0) + 1);
  const [line] = [...heights].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? [];
  if (!line || e.rect.height < line * 1.6 || e.rect.height > line * 2.6) return { x: e.x, y: e.y };
  return {
    x: Math.round(e.rect.x + e.rect.width - Math.max(4, line / 4)),
    y: Math.round(e.rect.y + line / 2),
  };
}

/**
 * The element of a ref: one of the list, else one the list leaves out that the whole tree gives, as a container, at its
 * middle as a listed one is. It has no words of its own, or the list would hold it.
 */
export function byRef(
  x: { list: ScreenElement[]; elements: UiElement[] },
  ref: string,
): ScreenElement | undefined {
  const listed = x.list.find((e) => e.ref === ref);
  if (listed) return listed;
  const el = x.elements.find((e) => e.ref === ref);
  const rect = el?.rect;
  if (!el || !rect) return undefined;
  const at = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  return {
    ref,
    role: bare(el.type),
    label: '',
    name: '',
    nameKind: 'position',
    rect,
    ...at,
    flags: [],
  };
}

/** The roles of a row that holds its own control of that role, as SwiftUI's Toggle: its middle is its label. */
const TOGGLES = new Set(['switch', 'checkbox']);
/** Where along its long side a control is touched when a smaller one has its middle. */
const ASIDE = [0.25, 0.75, 0.1, 0.9];

const area = (r: Rect) => r.width * r.height;
const holds = (r: Rect, p: Point) =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/**
 * Where a touch on an element goes. `own`: on its own switch, `other`, where the row's middle is its label. `clear`: at
 * a point clear of `other`, a smaller control of other words at its middle, which would take the touch (a mini player's
 * Pause). `covered`: at its middle still, as no point of it is clear of such controls, and `other` may take the touch.
 */
export type TouchPoint = {
  point: Point;
  why?: 'own' | 'clear' | 'covered';
  other?: ScreenElement;
};

/** Where a touch on a listed control goes where its middle is not its own. */
function ownPoint(e: ScreenElement, list: ScreenElement[]): TouchPoint | undefined {
  if (!list.includes(e) || !e.flags.includes('clickable') || e.flags.includes('web')) return;
  const smaller = list.filter(
    (c) => c !== e && within(c.rect, e.rect) && area(c.rect) * 2 <= area(e.rect),
  );
  const own = TOGGLES.has(e.role) ? smaller.find((c) => c.role === e.role) : undefined;
  if (own) return { point: { x: own.x, y: own.y }, why: 'own', other: own };
  // its own words past the list's cut are its own still
  const words = (c: ScreenElement) => c.whole ?? c.label;
  const controls = smaller.filter(
    (c) => c.flags.includes('clickable') && !(words(c) && words(e).includes(words(c))),
  );
  const over = controls.find((c) => holds(c.rect, e));
  if (!over) return;
  const { x, y, width, height } = e.rect;
  const free = ASIDE.map((f) =>
    width >= height
      ? { x: Math.round(x + width * f), y: e.y }
      : { x: e.x, y: Math.round(y + height * f) },
  ).find((p) => !controls.some((c) => holds(c.rect, p)));
  return free
    ? { point: free, why: 'clear', other: over }
    : { point: { x: e.x, y: e.y }, why: 'covered', other: over };
}

/** Where a touch on `e`, one of `list`, goes: a point of its own where its middle is another control's, else `landing`. */
export const touchPoint = (e: ScreenElement, list: ScreenElement[]): TouchPoint =>
  ownPoint(e, list) ?? { point: landing(e, list) };

/** An element as an answer names it: its ref and its words. */
export const refName = (ref: string, words: string) => `${ref} ${JSON.stringify(words)}`;

/**
 * What a touch calls the element of `ref`: `name`, which begins with its words at the touch, and where those are not
 * the words it was shown with, `was`, those too, as a ref of an older screen read as if the touch had renamed it.
 */
export const withShownWords = (name: string, ref: string, was: string | undefined) =>
  was === undefined || name.startsWith(refName(ref, was))
    ? name
    : `${name} (shown as ${JSON.stringify(was)})`;

/**
 * A touch's options where a selector found each of its targets on one read, `found`: the device compares the screen it
 * reaches with that read, not with the one before the call, which a window that came in front by itself has replaced
 * since. Options that name no read to compare with stay so.
 */
export const comparedWith = <O extends { before?: string }>(
  opts: O,
  ...found: (string | undefined)[]
): O => {
  const [on] = found;
  return opts.before && on && found.every((f) => f === on) ? { ...opts, before: on } : opts;
};
