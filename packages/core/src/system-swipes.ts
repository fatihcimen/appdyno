import { pause } from './call.js';
import type { InputEvent } from './mirror/port.js';

/** A finger's way down the screen, as fractions of it: from the top edge, or the middle of a home screen. */
export type SystemSwipe = { x: number; from: number; to: number; times?: number };

export const SYSTEM_SWIPES = {
  // inside the corner's curve, near the battery: past it a screen has nothing to touch
  controlCenter: { x: 0.84, from: 0.012, to: 0.55 },
  notifications: { x: 0.3, from: 0, to: 0.65 },
  spotlight: { x: 0.5, from: 0.35, to: 0.55 },
  quickSettings: { x: 0.5, from: 0, to: 0.6, times: 2 },
} satisfies Record<string, SystemSwipe>;

const STEPS = 10;
const STEP_MS = 16;
const APART_MS = 400;

/** The drag as a person's, event by event: what a window's control sends, and a device's mirror takes with no window. */
export async function swipeThrough(
  { x, from, to, times = 1 }: SystemSwipe,
  send: (e: InputEvent) => unknown,
) {
  for (let n = 0; n < times; n++) {
    await send({ kind: 'touch', p: 0, x, y: from });
    for (let i = 1; i <= STEPS; i++) {
      await pause(STEP_MS);
      await send({ kind: 'touch', p: 1, x, y: from + ((to - from) * i) / STEPS });
    }
    await send({ kind: 'touch', p: 2, x, y: to });
    if (n + 1 < times) await pause(APART_MS);
  }
}

/** The same drag as one finger's path, for a device with no input of its own but its agent. */
export const swipePath = ({ x, from, to }: SystemSwipe, size: { w: number; h: number }) => [
  { x: x * size.w, y: from * size.h, t: 0 },
  { x: x * size.w, y: to * size.h, t: STEPS * STEP_MS },
];

/** The system's own views a person opens by name. */
export const SYSTEM_VIEWS = ['control_center', 'notification_center', 'spotlight'] as const;
export type SystemView = (typeof SYSTEM_VIEWS)[number];
