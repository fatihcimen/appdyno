import type { Screen, ScreenElement } from '@appdyno/core';
import {
  bestSelector,
  elementAt,
  type Flag,
  type FlowSelector,
  type FlowStep,
} from '@appdyno/flows';
import { defined } from './shared.js';

export type Size = { w: number; h: number };

/** A target named for later, and the screen it was named on. */
export type Aim = {
  screen?: Screen | undefined;
  element?: ScreenElement | undefined;
  selector?: FlowSelector;
  args?: Record<string, string | number>;
  flags?: Flag[];
};

/** The selector of an element, and whether it had to be picked among several. */
export const named = (screen: Pick<Screen, 'list' | 'elements'>, e: ScreenElement) => {
  const c = bestSelector(screen, e);
  return {
    selector: c.selector,
    flags: (c.ambiguous !== undefined ? ['ambiguous'] : []) as Flag[],
  };
};

/** A point of a screen: the element a touch there reaches when anything names it, else flagged coordinates. */
export function aimAt(screen: Screen, p: { x: number; y: number }, size: Size | undefined): Aim {
  const e = size && elementAt(screen.list, p, size);
  if (e) return { screen, element: e, ...named(screen, e) };
  return {
    screen,
    args: { x: p.x, y: p.y, ...(size && { screen: `${size.w}x${size.h}` }) },
    flags: ['coordinates'],
  };
}

export const stepOf = (
  action: FlowStep['action'],
  a: Aim,
  args: Record<string, string | number | boolean | undefined> = {},
): FlowStep => ({
  action,
  line: 0,
  ...(a.selector && { selector: a.selector }),
  args: defined({ ...args, ...a.args }),
  flags: a.flags ?? [],
});

/** What a flow has no step for: replay stops here rather than go on without it. */
export const unrecorded = (what: string): FlowStep => ({
  action: 'unrecorded',
  line: 0,
  args: { what },
  flags: [],
});
