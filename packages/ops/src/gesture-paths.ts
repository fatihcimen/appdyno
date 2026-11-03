import type { Point } from '@appdyno/protocol';
import { z } from 'zod';
import { Direction } from './step-schemas.js';

/**
 * A swipe's start and end on a screen of `size`: from x,y (the centre) by `distance` (40 % of the
 * screen), both points inside the screen (an edge point would start a system gesture).
 */
export function swipeLine(
  size: { w: number; h: number },
  s: { direction: z.infer<typeof Direction>; x?: number; y?: number; distance?: number },
): { from: Point; to: Point } {
  const horizontal = s.direction === 'left' || s.direction === 'right';
  const from = { x: s.x ?? size.w / 2, y: s.y ?? size.h / 2 };
  const dist = s.distance ?? (horizontal ? size.w : size.h) * 0.4;
  // the finger's way: `up` moves the content up (the list scrolls on)
  const sign = s.direction === 'up' || s.direction === 'left' ? -1 : 1;
  const to = horizontal
    ? { x: from.x + sign * dist, y: from.y }
    : { x: from.x, y: from.y + sign * dist };
  const clamp = (p: Point) => ({
    x: Math.round(Math.min(Math.max(p.x, 1), size.w - 1)),
    y: Math.round(Math.min(Math.max(p.y, 1), size.h - 1)),
  });
  return { from: clamp(from), to: clamp(to) };
}

/** Two fingers from the point outwards (scale > 1, zoom in) or inwards (scale < 1). */
export function pinchPaths(
  c: Point,
  scale: number,
  durationMs: number,
  size: { w: number; h: number },
) {
  const r0 = Math.min(size.w, size.h) * (scale >= 1 ? 0.1 : 0.3);
  const r1 = Math.min(Math.max(r0 * scale, 10), Math.min(size.w, size.h) * 0.45);
  const finger = (sign: number) => [
    { x: c.x + sign * r0, y: c.y, t: 0 },
    { x: c.x + sign * r1, y: c.y, t: durationMs },
  ];
  return [finger(-1), finger(1)];
}

/** A finger from one point to another with no flick: held at the start, if asked, and at the end. */
export const dragPath = (from: Point, to: Point, durationMs: number, holdMs = 0) => [
  { ...from, t: 0 },
  ...(holdMs ? [{ ...from, t: holdMs }] : []),
  { ...to, t: holdMs + durationMs },
  { ...to, t: holdMs + durationMs + 80 },
];
