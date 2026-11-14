import {
  bare,
  cutContext,
  inPart,
  KEYBOARD_REF,
  nearest,
  selectIn,
  type Rect,
  type Screen,
  type ScreenElement,
  type Selector as SelectorOf,
} from '@appdyno/core';
import type { Point } from '@appdyno/protocol';
import { UNREAD } from './checks.js';
import type { Session } from './session.js';
import { NAME_AN_ELEMENT, showSelector } from './step-schemas.js';
import { STALE_HINT, ToolError } from './tool.js';

const STALE = 'stale ref, read the screen again';

/** How long a selector with no match waits for its element, as a screen may still be coming. */
export const NO_MATCH_WAIT_MS = 1_500;

/** How a step names elements: by its words made safe, one to a line, and the nearest to what it wanted. */
export type Words = {
  clean: (s: string) => string;
  line: (e: ScreenElement) => string;
  offer: (list: ScreenElement[], want?: string) => string;
};

export function wordsOf(clean: (s: string) => string): Words {
  // what tells like elements apart is the row each is in, where the list has one
  const line = (e: ScreenElement) =>
    `${e.ref} ${e.role} ${JSON.stringify(clean(e.label || e.id || ''))} ${e.x},${e.y}${e.refContext ? ` — ${cutContext(clean(e.refContext))}` : ''}`;
  const offer = (list: ScreenElement[], want?: string) => {
    const near = nearest(list, want).map(line);
    return near.length > 0 ? `; nearest: ${near.join('; ')}` : '';
  };
  return { clean, line, offer };
}

/** The matches a refusal lists, of many. */
const MANY_SHOWN = 10;

/** `a` lies wholly inside `b`. */
const within = (a: Rect, b: Rect) =>
  a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

/** One element of a selector's matches, or a refusal listing them; `sent`: swipes went before, as `scroll_to`'s. */
export function pick(
  hits: ScreenElement[],
  sel: SelectorOf,
  line: Words['line'],
  sent = false,
): ScreenElement {
  const listed = `${hits.slice(0, MANY_SHOWN).map(line).join('; ')}${hits.length > MANY_SHOWN ? `; and ${hits.length - MANY_SHOWN} more` : ''}`;
  const { index, ...words } = sel;
  if (index !== undefined && index >= hits.length)
    throw new ToolError(
      `only ${hits.length} ${hits.length === 1 ? 'element matches' : 'elements match'} ${showSelector(words)}, so index ${index} names none: ${listed}`,
      'NOT_FOUND',
      `give an index below ${hits.length}, 0 for the first listed, or use a ref`,
      sent || undefined,
    );
  // a control and its own text inside it, with the same words (an Android row), are one target
  const inside = (a: ScreenElement, b: ScreenElement) => a !== b && within(a.rect, b.rect);
  // a web link and its own text take the same box: each inside the other, and the one a touch acts on is the target
  const boxed = new Map<string, ScreenElement>();
  for (const e of hits) {
    const box = `${e.rect.x},${e.rect.y},${e.rect.width},${e.rect.height}`;
    const had = boxed.get(box);
    if (!had || (!had.flags.includes('clickable') && e.flags.includes('clickable')))
      boxed.set(box, e);
  }
  const placed = [...boxed.values()];
  const outer = placed.filter((a) => !placed.some((b) => inside(a, b)));
  const hit = index === undefined ? (outer.length === 1 ? outer[0] : undefined) : hits[index];
  if (hit) return hit;
  throw new ToolError(
    `${hits.length} elements match ${showSelector(sel)}: ${listed}`,
    'AMBIGUOUS',
    'give the selector an index, 0 for the first listed, or use a ref',
    sent || undefined,
  );
}

/** What to do about an app that left the front by itself, as the answer to an action says it. */
const GONE_HINT = 'launch_app brings it back, and crashes says why if it crashed';

/**
 * What a screen with no match offers in its place: the nearest labels, or, with the app gone from the front by itself,
 * that it is, as the labels would be another app's.
 */
export function missed(
  s: Session,
  screen: Screen,
  want: string | undefined,
  offer: Words['offer'],
) {
  const { appId } = s;
  const front = screen.foreground;
  if (appId && front && front !== appId && !s.leftApp)
    return { said: `; ${appId} is not in front (${front})`, hint: GONE_HINT };
  return { said: offer(screen.list, want) };
}

/** A selector on a fresh read, and that read's hash; no match waits a moment, as the screen may still be coming. */
async function resolve(
  s: Session,
  sel: SelectorOf,
  { line, offer }: Words,
): Promise<{ e: ScreenElement; list: ScreenElement[]; on: string }> {
  const { screen, met } = await s.until((x) => selectIn(x.list, sel).length > 0, NO_MATCH_WAIT_MS);
  if (!screen) throw new ToolError('the screen could not be read', 'NOT_FOUND', UNREAD);
  if (!met) {
    const why = missed(s, screen, sel.text ?? sel.id, offer);
    throw new ToolError(
      `no element matches ${showSelector(sel)} after ${NO_MATCH_WAIT_MS} ms${why.said}`,
      'NOT_FOUND',
      why.hint ?? 'read the screen, or use scroll_to if it may be further along a list',
    );
  }
  return { e: pick(selectIn(screen.list, sel), sel, line), list: screen.list, on: screen.hash };
}

export type Aim = { ref?: string; x?: number; y?: number; selector?: SelectorOf };

/**
 * Where a touch on `e` lands: its middle, but on a web element over two lines, as a link that wraps, its first line's
 * end, where the middle of its box is the text between the lines. A line is as tall as most of the page's elements.
 */
export function landing(e: ScreenElement, list: ScreenElement[]) {
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
 * The element of a ref: one of the list, else one the list leaves out that `screen raw` gives, as a container, at its
 * middle as a listed one is. It has no words of its own, or the list would hold it.
 */
export function byRef(x: Screen, ref: string): ScreenElement | undefined {
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

/** What a touch's answer adds where a selector's text named its element by only a part of a paragraph. */
export const partly = (e: ScreenElement, sel: SelectorOf) =>
  inPart(e, sel)
    ? ` (only a part of its words: nothing here reads ${JSON.stringify(sel.text)} alone)`
    : '';

/** The roles of a row that holds its own control of that role, as SwiftUI's Toggle: its middle is its label. */
const TOGGLES = new Set(['switch', 'checkbox']);
/** Where along its long side a control is touched when a smaller one has its middle. */
const ASIDE = [0.25, 0.75, 0.1, 0.9];

const area = (r: Rect) => r.width * r.height;
const holds = (r: Rect, p: Point) =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/**
 * Where a touch on a listed control goes where its middle is not its own: on its own switch, or clear of a smaller
 * control of other words at its middle, which would take the touch (a mini player's Pause); `note` says so.
 */
function ownPoint(e: ScreenElement, list: ScreenElement[], named: (c: ScreenElement) => string) {
  if (!list.includes(e) || !e.flags.includes('clickable') || e.flags.includes('web')) return;
  const smaller = list.filter(
    (c) => c !== e && within(c.rect, e.rect) && area(c.rect) * 2 <= area(e.rect),
  );
  const own = TOGGLES.has(e.role) ? smaller.find((c) => c.role === e.role) : undefined;
  if (own) return { point: { x: own.x, y: own.y }, note: ` by its own ${e.role} ${named(own)}` };
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
    ? { point: free, note: ` at ${free.x},${free.y}, clear of ${named(over)} at its middle` }
    : {
        point: { x: e.x, y: e.y },
        note: `, whose middle is ${named(over)}'s, which may take the touch`,
      };
}

/** An element as a touch aims at it; the keyboard is listed whole, and a touch on it would type one key. */
function aimedAt(e: ScreenElement, clean: Words['clean'], list: ScreenElement[]) {
  if (e.ref === KEYBOARD_REF)
    throw new ToolError(
      `${KEYBOARD_REF} is the on-screen keyboard: type_text types, press_key enter presses its return key, and keyboard dismiss closes it`,
      'INVALID_ARGUMENT',
      undefined,
      false,
    );
  const named = (c: ScreenElement) => `${c.ref} ${JSON.stringify(clean(c.label))}`;
  const own = ownPoint(e, list, named);
  return own
    ? { point: own.point, name: `${named(e)}${own.note}` }
    : { point: landing(e, list), name: named(e) };
}

/** Where a touch goes and what its answer calls it; `on`: the read a selector found it on, which the touch is compared with. */
export type Aimed = { point: Point; name: string; on?: string };

/** The point of a ref (on the device's current screen), a selector or x,y. */
export async function aim(s: Session, a: Aim, words: Words): Promise<Aimed> {
  const { clean, offer } = words;
  if (a.ref) {
    const ref = a.ref;
    const has = (x: Screen | undefined) => {
      const e = x && byRef(x, ref);
      return e && { e, list: x.list };
    };
    // a read on a loaded device, or of an app not answering, can come back short of what the last one listed: the ref
    // is waited for as a selector is, and one still not there is said with its words and what is there in their place
    const first = await s.justNow();
    const waited = has(first) ? undefined : await s.until((x) => !!has(x), NO_MATCH_WAIT_MS);
    const found = has(first) ?? has(waited?.screen);
    if (!found) {
      const was = s.refWords.get(a.ref);
      const now = waited?.screen ?? first;
      throw new ToolError(
        `${STALE}: ${a.ref}${was ? ` ${JSON.stringify(clean(was))}` : ''} is not on this screen${was ? offer(now.list, was) : ''}`,
        'STALE',
        STALE_HINT,
      );
    }
    return aimedAt(found.e, clean, found.list);
  }
  if (a.selector) {
    const { e, list, on } = await resolve(s, a.selector, words);
    const aimed = aimedAt(e, clean, list);
    return { ...aimed, name: `${aimed.name}${partly(e, a.selector)}`, on };
  }
  if (a.x === undefined || a.y === undefined)
    throw new ToolError('give a ref, a selector, or x and y', 'INVALID_ARGUMENT', NAME_AN_ELEMENT);
  return { point: { x: a.x, y: a.y }, name: `${a.x},${a.y}` };
}
