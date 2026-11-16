import {
  byRef,
  cutContext,
  inPart,
  KEYBOARD_REF,
  nearest,
  oneOf,
  refName,
  selectIn,
  touchPoint,
  type Screen,
  type ScreenElement,
  type Selector as SelectorOf,
} from '@appdyno/core';
import type { Point } from '@appdyno/protocol';
import { UNREAD } from './checks.js';
import type { Session } from './session.js';
import { NAME_AN_ELEMENT, showSelector } from './step-schemas.js';
import { STALE_HINT, ToolError } from './tool.js';

export { landing } from '@appdyno/core';

const STALE = 'stale ref';

/** What to do about a selector nothing matched, where the answer does not hold the screen. */
export const NO_MATCH_HINT = 'read the screen, or use scroll_to if it may be further along a list';

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
  const hit = oneOf(hits, index);
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
      why.hint ?? NO_MATCH_HINT,
    );
  }
  return { e: pick(selectIn(screen.list, sel), sel, line), list: screen.list, on: screen.hash };
}

export type Aim = { ref?: string; x?: number; y?: number; selector?: SelectorOf };

/** What a touch's answer adds where a selector's text named its element by only a part of a paragraph. */
export const partly = (e: ScreenElement, sel: SelectorOf) =>
  inPart(e, sel)
    ? ` (only a part of its words: nothing here reads ${JSON.stringify(sel.text)} alone)`
    : '';

/** An element as a touch aims at it; the keyboard is listed whole, and a touch on it would type one key. */
function aimedAt(e: ScreenElement, clean: Words['clean'], list: ScreenElement[]) {
  if (e.ref === KEYBOARD_REF)
    throw new ToolError(
      `${KEYBOARD_REF} is the on-screen keyboard: type_text types, press_key enter presses its return key, and keyboard dismiss closes it`,
      'INVALID_ARGUMENT',
      undefined,
      false,
    );
  const named = (c: ScreenElement) => refName(c.ref, clean(c.label));
  const { point, why, other } = touchPoint(e, list);
  if (!why || !other) return { point, name: named(e) };
  const note = {
    own: ` by its own ${other.role} ${named(other)}`,
    clear: ` at ${point.x},${point.y}, clear of ${named(other)} at its middle`,
    covered: `, whose middle is ${named(other)}'s, which may take the touch`,
  }[why];
  return { point, name: `${named(e)}${note}` };
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
