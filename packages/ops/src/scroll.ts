import {
  must,
  pause,
  reportProgress,
  selectIn,
  throwIfCancelled,
  type Screen,
  type ScreenElement,
  type Selector as SelectorOf,
} from '@appdyno/core';
import type { ActResult } from '@appdyno/protocol';
import type { z } from 'zod';
import { SETTLE } from './answers.js';
import { slowingPath } from './gesture-paths.js';
import type { Session } from './session.js';
import { type Direction, showSelector } from './step-schemas.js';
import { ToolError } from './tool.js';

/** A scroll's finger travels this share of the list either way from its middle. */
const SCROLL_REACH = 0.35;

/**
 * How long a target holds its place before it counts as still, and the most that is waited for that. A
 * list coasting after a scroll is not caught by the settle on a simulator (its content is the same, its
 * places within a tolerance), and UIKit takes a touch on a coasting list as "stop", not as a press:
 * measured, half of the taps right after a scroll were lost, none of 9 after 500 ms. Rects come in whole
 * points, so one equal pair of reads does not show it stopped.
 */
const STILL_MS = 300;

const STILL_CAP_MS = 2_500;

const STILL_GAP_MS = 50;

/** A stroke covers at most this share of the list, so that what is on the screen after it was there before. */
const STROKE_REACH = 0.6;

/** A slow stroke, and its finger still this long before it lifts. */
const STROKE_MS = 900;
const STROKE_REST_MS = 200;
/** A stroke that looks for something need not be so slow: only stop. */
const SEEK_STROKE_MS = 500;
/** A list that does not take this many in a row has ended: one stroke alone may land as a screen still arrives. */
const STILL_STROKES = 2;

/** Whether the same things stand in the same places: reads a list that gives a little as one that did not move. */
export const moved = (was: ScreenElement[], now: ScreenElement[]) =>
  was.length !== now.length ||
  was.some((e, i) => {
    const o = must(now[i], 'the element now at its place');
    return e.label !== o.label || Math.abs(e.y - o.y) >= 8 || Math.abs(e.x - o.x) >= 8;
  });

/** What a finger travels before the list takes it, as a first guess: each stroke then measures it. */
const SLOP = 12;

/** Whole points or pixels, and a rect read as the list stops: this close is there. */
const CLOSE_ENOUGH = 2;

type Box = { x: number; y: number; width: number; height: number };

/**
 * How far what two reads share moved along an axis, by the most common distance that is not 0, as a bar keeps its
 * place. Only a label said once tells an element: the rows' repeated words keep their order, not their place.
 * Undefined: they share nothing to measure by.
 */
function shift(was: ScreenElement[], now: ScreenElement[], box: Box, vertical: boolean) {
  const inside = ({ rect: r }: ScreenElement) =>
    r.x >= box.x &&
    r.y >= box.y &&
    r.x + r.width <= box.x + box.width &&
    r.y + r.height <= box.y + box.height;
  const once = (list: ScreenElement[]) => {
    const seen = new Map<string, number>();
    for (const e of list) seen.set(e.label, (seen.get(e.label) ?? 0) + 1);
    return list.filter((e) => e.label && seen.get(e.label) === 1 && inside(e));
  };
  const before = new Map(once(was).map((e) => [e.label, e.rect]));
  const moves = once(now).flatMap((e) => {
    const o = before.get(e.label);
    return o ? [vertical ? e.rect.y - o.y : e.rect.x - o.x] : [];
  });
  if (moves.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const m of moves) if (m !== 0) counts.set(m, (counts.get(m) ?? 0) + 1);
  return [...counts].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 0;
}

/** What scrolling takes from the steps around it. */
type Around = {
  windowSize: (s: Session) => Promise<{ w: number; h: number }>;
  line: (e: ScreenElement) => string;
  pick: (hits: ScreenElement[], sel: SelectorOf) => ScreenElement;
  offer: (list: ScreenElement[], want?: string) => string;
};

/** Moving a list until something is on the screen, or by a distance. */
export function scrollingFor({ windowSize, line, pick, offer }: Around) {
  /**
   * The biggest scrolling container, the one under x,y if given; else the whole window. Sideways, a row across the
   * page where one says it scrolls, as the page is the bigger and does not move that way.
   */
  const scrollArea = (
    screen: Screen,
    a: { x?: number; y?: number },
    w: { w: number; h: number },
    vertical: boolean,
  ) => {
    const under = (r: { x: number; y: number; width: number; height: number }) =>
      a.x === undefined ||
      a.y === undefined ||
      (a.x >= r.x && a.x <= r.x + r.width && a.y >= r.y && a.y <= r.y + r.height);
    const boxes = screen.elements
      .flatMap((e) =>
        e.scrollable && e.rect && e.visible !== false && under(e.rect) ? [e.rect] : [],
      )
      .sort((p, q) => q.width * q.height - p.width * p.height);
    const row = vertical ? undefined : boxes.findLast((r) => r.width > r.height);
    return row ?? boxes[0] ?? { x: 0, y: 0, width: w.w, height: w.h };
  };

  /** Where a finger crosses a box: on the line through the point asked for, as that is what it is to move. */
  const strokeCentre = (box: Box, a: { x?: number; y?: number }, vertical: boolean) => ({
    x: Math.round(vertical && a.x !== undefined ? a.x : box.x + box.width / 2),
    y: Math.round(!vertical && a.y !== undefined ? a.y : box.y + box.height / 2),
  });

  /** Reads until the selector's element has kept its place for a while, the last read with it; it may be gone or still moving at the cap. */
  const holdsStill = async (s: Session, sel: SelectorOf): Promise<Screen> => {
    const end = Date.now() + STILL_CAP_MS;
    let place: string | undefined;
    let since = 0;
    for (;;) {
      const screen = await s.read();
      const r = selectIn(screen.list, sel)[sel.index ?? 0]?.rect;
      if (!r) return screen;
      const now = `${r.x},${r.y},${r.width},${r.height}`;
      if (now !== place) {
        place = now;
        since = Date.now();
      } else if (Date.now() - since >= STILL_MS) return screen;
      if (Date.now() >= end) return screen;
      await pause(STILL_GAP_MS);
    }
  };

  /** Scrolls until the selector's element is on the screen; a list that did not move has ended. */
  const scrollTo = async (
    s: Session,
    a: {
      selector: SelectorOf;
      direction: z.infer<typeof Direction>;
      maxSwipes: number;
      x?: number;
      y?: number;
    },
  ) => {
    let screen = await s.read();
    let last: ActResult = { tree: screen.tree };
    let still = 0;
    const what = showSelector(a.selector);
    for (let swipes = 0; ; swipes++) {
      let hits = selectIn(screen.list, a.selector);
      if (hits.length > 0 && swipes > 0) {
        // the answer says where it is: not while the list still carries it along
        screen = await holdsStill(s, a.selector);
        last = { ...last, ...(last.tree && { tree: screen.tree }) };
        hits = selectIn(screen.list, a.selector);
      }
      if (hits.length > 0)
        return {
          r: last,
          done: `found ${line(pick(hits, a.selector))} after ${swipes} swipes`,
          found: true,
        };
      if (swipes >= a.maxSwipes)
        throw new ToolError(
          `${what} not found after ${swipes} swipes; the list can still move${offer(screen.list, a.selector.text)}`,
          'NOT_FOUND',
          'raise maxSwipes',
          swipes > 0,
        );
      const vertical = a.direction === 'up' || a.direction === 'down';
      const box = scrollArea(screen, a, await windowSize(s), vertical);
      const { x: cx, y: cy } = strokeCentre(box, a, vertical);
      // sideways, only what the finger's line crosses says the list moved: a banner elsewhere changes by itself
      const inner = (e: ScreenElement) =>
        e.x >= box.x &&
        e.x <= box.x + box.width &&
        e.y >= box.y &&
        e.y <= box.y + box.height &&
        (vertical || (e.rect.y <= cy && cy <= e.rect.y + e.rect.height));
      const sign = a.direction === 'up' || a.direction === 'left' ? -1 : 1;
      const dx = vertical ? 0 : Math.round(sign * box.width * SCROLL_REACH);
      const dy = vertical ? Math.round(sign * box.height * SCROLL_REACH) : 0;
      reportProgress(`scrolling (${swipes + 1} of ${a.maxSwipes})`);
      last = await s.device.act(
        {
          kind: 'gesture',
          // a finger that stops: a list left coasting ran past the row, and on to its end
          pointers: [
            slowingPath(
              { x: cx - dx, y: cy - dy },
              { x: cx + dx, y: cy + dy },
              SEEK_STROKE_MS,
              STROKE_REST_MS,
            ),
          ],
        },
        { settle: SETTLE, read: 'tree', before: screen.hash },
      );
      // a call refused meanwhile, as its app died, is over: no more strokes, and no read of it for the session
      throwIfCancelled('scroll_to');
      s.acted();
      const next = last.tree ? s.screenOf(last.tree) : await s.read();
      s.remember(next);
      still = moved(screen.list.filter(inner), next.list.filter(inner)) ? 0 : still + 1;
      if (still >= STILL_STROKES)
        throw new ToolError(
          `${what} not found: the list did not move after ${swipes + 1} swipes, so this is its end${offer(next.list, a.selector.text)}`,
          'NOT_FOUND',
          'try the other direction, or give x and y on the list',
          true,
        );
      screen = next;
    }
  };

  /** The screen once what is on it no longer moves: a slow stroke's list may still give a little. */
  const stopped = async (s: Session, first: Screen, box: Box, vertical: boolean) => {
    const end = Date.now() + STILL_CAP_MS;
    let screen = first;
    while (Date.now() < end) {
      await pause(STILL_MS);
      const next = await s.read();
      const moved = shift(screen.list, next.list, box, vertical);
      screen = next;
      if (!moved) break;
    }
    return screen;
  };

  /**
   * The content moved by `distance`, measured on what each read shares with the last: a stroke's finger stops before it
   * lifts, what the list took of it says how much of the next is lost to the start of a drag, and a list that no
   * longer moves has ended, which is no failure.
   */
  const scrollBy = async (
    s: Session,
    a: { direction: z.infer<typeof Direction>; distance: number; x?: number; y?: number },
  ) => {
    const vertical = a.direction === 'up' || a.direction === 'down';
    const sign = a.direction === 'up' || a.direction === 'left' ? -1 : 1;
    let screen = await s.read();
    const box = scrollArea(screen, a, await windowSize(s), vertical);
    const reach = (vertical ? box.height : box.width) * STROKE_REACH;
    const c = strokeCentre(box, a, vertical);
    const most = Math.ceil(a.distance / reach) + 4;
    let moved = 0;
    let lost = SLOP;
    let strokes = 0;
    let last: ActResult = { tree: screen.tree };
    let ended = false;
    while (Math.abs(a.distance - moved) > CLOSE_ENOUGH && strokes < most && !ended) {
      const left = a.distance - moved;
      const length = Math.min(Math.abs(left) + lost, reach);
      const half = (Math.sign(left) * sign * length) / 2;
      const at = (k: number) => ({
        x: Math.round(c.x + (vertical ? 0 : k * half)),
        y: Math.round(c.y + (vertical ? k * half : 0)),
      });
      reportProgress(`scrolling (stroke ${strokes + 1})`);
      last = await s.device.act(
        { kind: 'gesture', pointers: [slowingPath(at(-1), at(1), STROKE_MS, STROKE_REST_MS)] },
        { settle: SETTLE, read: 'tree', before: screen.hash },
      );
      throwIfCancelled('swipe');
      s.acted();
      strokes++;
      const next = await stopped(
        s,
        last.tree ? s.screenOf(last.tree) : await s.read(),
        box,
        vertical,
      );
      const went = shift(screen.list, next.list, box, vertical);
      if (went === undefined)
        throw new ToolError(
          `nothing stayed on the screen to measure by after ${strokes} strokes, having moved ${Math.abs(moved)}`,
          'UNSUPPORTED',
          'a swipe without exact moves such a screen, with no promise of how far',
          true,
        );
      const asked = went * sign;
      ended = asked === 0;
      if (!ended) lost = Math.max(0, length - Math.abs(asked));
      moved += asked;
      screen = next;
      last = { ...last, ...(last.tree && { tree: screen.tree }) };
    }
    const end = ended ? ': the list ended' : '';
    return {
      r: last,
      done: `scrolled ${a.direction} ${moved} of ${a.distance} in ${strokes} stroke${strokes === 1 ? '' : 's'}${end}`,
    };
  };

  return { holdsStill, scrollTo, scrollBy };
}
