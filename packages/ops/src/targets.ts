import {
  cutContext,
  KEYBOARD_REF,
  nearest,
  selectIn,
  type Screen,
  type ScreenElement,
  type Selector as SelectorOf,
} from '@appdyno/core';
import { UNREAD } from './checks.js';
import type { Session } from './session.js';
import { NAME_AN_ELEMENT, showSelector } from './step-schemas.js';
import { ToolError } from './tool.js';

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

/** One element of a selector's matches, or a refusal listing them. */
export function pick(hits: ScreenElement[], sel: SelectorOf, line: Words['line']): ScreenElement {
  // a control and its own text inside it, with the same words (an Android row), are one target
  const inside = (a: ScreenElement, b: ScreenElement) =>
    a !== b &&
    a.rect.x >= b.rect.x &&
    a.rect.y >= b.rect.y &&
    a.rect.x + a.rect.width <= b.rect.x + b.rect.width &&
    a.rect.y + a.rect.height <= b.rect.y + b.rect.height;
  const outer = hits.filter((a) => !hits.some((b) => inside(a, b)));
  const hit =
    sel.index === undefined ? (outer.length === 1 ? outer[0] : undefined) : hits[sel.index];
  if (hit) return hit;
  const more = hits.length > MANY_SHOWN ? `; and ${hits.length - MANY_SHOWN} more` : '';
  throw new ToolError(
    `${hits.length} elements match ${showSelector(sel)}: ${hits.slice(0, MANY_SHOWN).map(line).join('; ')}${more}`,
    'AMBIGUOUS',
    'give the selector an index, 0 for the first listed, or use a ref',
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

/** A selector on a fresh read; no match waits a moment, as the screen may still be coming. */
async function resolve(
  s: Session,
  sel: SelectorOf,
  { line, offer }: Words,
): Promise<ScreenElement> {
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
  return pick(selectIn(screen.list, sel), sel, line);
}

export type Aim = { ref?: string; x?: number; y?: number; selector?: SelectorOf };

/** An element as a touch aims at it; the keyboard is listed whole, and a touch on it would type one key. */
function aimedAt(e: ScreenElement, clean: Words['clean']) {
  if (e.ref === KEYBOARD_REF)
    throw new ToolError(
      `${KEYBOARD_REF} is the on-screen keyboard: type_text types, press_key enter presses its return key, and keyboard dismiss closes it`,
      'INVALID_ARGUMENT',
      undefined,
      false,
    );
  return { point: { x: e.x, y: e.y }, name: `${e.ref} ${JSON.stringify(clean(e.label))}` };
}

/** The point of a ref (on the device's current screen), a selector or x,y. */
export async function aim(s: Session, a: Aim, patient: boolean, words: Words) {
  const { clean } = words;
  if (a.ref) {
    const has = (x: Screen | undefined) => x?.list.find((e) => e.ref === a.ref);
    const e =
      has(await s.justNow()) ??
      (patient ? has((await s.until((x) => !!has(x), NO_MATCH_WAIT_MS)).screen) : undefined);
    if (!e) throw new ToolError(`${STALE}: ${a.ref} is not on this screen`, 'STALE');
    return aimedAt(e, clean);
  }
  if (a.selector) return aimedAt(await resolve(s, a.selector, words), clean);
  if (a.x === undefined || a.y === undefined)
    throw new ToolError('give a ref, a selector, or x and y', 'INVALID_ARGUMENT', NAME_AN_ELEMENT);
  return { point: { x: a.x, y: a.y }, name: `${a.x},${a.y}` };
}
