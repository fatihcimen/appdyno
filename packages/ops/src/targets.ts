import {
  byRef,
  chosen,
  cutContext,
  inPart,
  KEYBOARD_REF,
  nearest,
  refName,
  seek,
  touchPoint,
  type Reads,
  type Screen,
  type ScreenElement,
  type Selector as SelectorOf,
  asName,
  onLine,
  quoted,
  shownLabel,
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
    `${e.ref} ${asName(e.role)} ${quoted(e.label ? shownLabel(e, clean) : clean(e.id ?? ''))} ${e.x},${e.y}${e.refContext ? ` — ${onLine(cutContext(clean(e.refContext)))}` : ''}`;
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
  const one = chosen(hits, index);
  if ('element' in one) return one.element;
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

/** How a session's read gives its elements: a ref names one of the list, else one of the whole tree. */
const READS: Reads<Screen, ScreenElement> = { list: (x) => x.list, byRef };

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
  const named = (c: ScreenElement) => refName(c.ref, shownLabel(c, clean));
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

/**
 * The point of a ref (on the device's current screen), a selector or x,y. One not there is waited for a moment, by the
 * rule a device opened from code aims by, and one still not there is said with its words and what is there in its place.
 */
export async function aim(s: Session, a: Aim, words: Words): Promise<Aimed> {
  const { clean, line, offer } = words;
  const target = a.ref ? { ref: a.ref } : a.selector;
  if (!target) {
    if (a.x === undefined || a.y === undefined)
      throw new ToolError(
        'give a ref, a selector, or x and y',
        'INVALID_ARGUMENT',
        NAME_AN_ELEMENT,
      );
    return { point: { x: a.x, y: a.y }, name: `${a.x},${a.y}` };
  }
  const got = await seek(
    { now: () => s.justNow(), until: (met, ms) => s.until(met, ms) },
    target,
    READS,
    NO_MATCH_WAIT_MS,
  );
  if ('element' in got) {
    const aimed = aimedAt(got.element, clean, got.list);
    if (!a.selector || a.ref) return aimed;
    return {
      ...aimed,
      name: `${aimed.name}${partly(got.element, a.selector)}`,
      on: got.screen.hash,
    };
  }
  if (!got.screen) throw new ToolError('the screen could not be read', 'NOT_FOUND', UNREAD);
  if ('ref' in target) {
    const was = s.refWords.get(target.ref);
    throw new ToolError(
      `${STALE}: ${target.ref}${was ? ` ${JSON.stringify(clean(was))}` : ''} is not on this screen${was ? offer(got.screen.list, was) : ''}`,
      'STALE',
      STALE_HINT,
    );
  }
  // several, or an index past the last: refused with the matches listed
  if (got.miss !== 'none') pick(got.hits, target, line);
  const why = missed(s, got.screen, target.text ?? target.id, offer);
  throw new ToolError(
    `no element matches ${showSelector(target)} after ${NO_MATCH_WAIT_MS} ms${why.said}`,
    'NOT_FOUND',
    why.hint ?? NO_MATCH_HINT,
  );
}
