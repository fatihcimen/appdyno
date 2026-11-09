import type { Screen, ScreenElement, UiElement } from '@appdyno/core';
import {
  bestSelector,
  elementAt,
  type Flag,
  type FlowSelector,
  type FlowStep,
} from '@appdyno/flows';
import type { Point } from '@appdyno/protocol';
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

/** A place only coordinates can give: it holds for this size of screen, and the file says so. */
export const pointAim = (p: Point, size: Size | undefined): Aim => ({
  args: { x: p.x, y: p.y, ...(size && { screen: `${size.w}x${size.h}` }) },
  flags: ['coordinates'],
});

/** A point of a screen: the element a touch there reaches when anything names it, else flagged coordinates. */
export function aimAt(screen: Screen, p: Point, size: Size | undefined): Aim {
  const e = size && elementAt(screen.list, p, size);
  return e ? { screen, element: e, ...named(screen, e) } : { screen, ...pointAim(p, size) };
}

/** A field as a recorded secret is called. */
export const fieldName = (el: UiElement) => el.identifier?.replace(/^[\w.]*:id\//, '');

export const stepOf = (
  action: FlowStep['action'],
  a: Aim,
  args: Record<string, string | number | boolean | string[] | undefined> = {},
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
