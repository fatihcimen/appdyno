import {
  pause,
  reportProgress,
  selectIn,
  type Screen,
  type ScreenElement,
  type Selector as SelectorOf,
} from '@appdyno/core';
import type { ActResult } from '@appdyno/protocol';
import type { z } from 'zod';
import { SETTLE } from './answers.js';
import { dragPath } from './gesture-paths.js';
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

/** What scrolling takes from the steps around it. */
type Around = {
  windowSize: (s: Session) => Promise<{ w: number; h: number }>;
  line: (e: ScreenElement) => string;
  pick: (hits: ScreenElement[], sel: SelectorOf) => ScreenElement;
  offer: (list: ScreenElement[], want?: string) => string;
};

/** Moving a list until something is on the screen. */
export function scrollingFor({ windowSize, line, pick, offer }: Around) {
  /** The biggest scrolling container, the one under x,y if given; else the whole window. */
  const scrollArea = (
    screen: Screen,
    a: { x?: number; y?: number },
    w: { w: number; h: number },
  ) => {
    const under = (r: { x: number; y: number; width: number; height: number }) =>
      a.x === undefined ||
      a.y === undefined ||
      (a.x >= r.x && a.x <= r.x + r.width && a.y >= r.y && a.y <= r.y + r.height);
    const boxes = screen.elements
      .filter((e) => e.scrollable && e.rect && e.visible !== false && under(e.rect))
      .map((e) => e.rect!)
      .sort((p, q) => q.width * q.height - p.width * p.height);
    return boxes[0] ?? { x: 0, y: 0, width: w.w, height: w.h };
  };

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
      const box = scrollArea(screen, a, await windowSize(s));
      const inner = (e: ScreenElement) =>
        e.x >= box.x && e.x <= box.x + box.width && e.y >= box.y && e.y <= box.y + box.height;
      const sign = a.direction === 'up' || a.direction === 'left' ? -1 : 1;
      const cx = Math.round(box.x + box.width / 2);
      const cy = Math.round(box.y + box.height / 2);
      const vertical = a.direction === 'up' || a.direction === 'down';
      const dx = vertical ? 0 : Math.round(sign * box.width * SCROLL_REACH);
      const dy = vertical ? Math.round(sign * box.height * SCROLL_REACH) : 0;
      reportProgress(`scrolling (${swipes + 1} of ${a.maxSwipes})`);
      last = await s.device.act(
        {
          kind: 'gesture',
          pointers: [dragPath({ x: cx - dx, y: cy - dy }, { x: cx + dx, y: cy + dy }, 400)],
        },
        { settle: SETTLE, read: 'tree', before: screen.hash },
      );
      s.acted();
      const next = last.tree ? s.screenOf(last.tree) : await s.read();
      s.remember(next);
      const was = screen.list.filter(inner);
      const now = next.list.filter(inner);
      const moved =
        was.length !== now.length ||
        was.some((e, i) => {
          const o = now[i]!;
          return e.label !== o.label || Math.abs(e.y - o.y) >= 8 || Math.abs(e.x - o.x) >= 8;
        });
      if (!moved)
        throw new ToolError(
          `${what} not found: the list did not move after ${swipes + 1} swipes, so this is its end${offer(next.list, a.selector.text)}`,
          'NOT_FOUND',
          'try the other direction',
          true,
        );
      screen = next;
    }
  };

  return { holdsStill, scrollTo };
}
