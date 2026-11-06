import type { InputEvent } from '@appdyno/core';

type Touch = Extract<InputEvent, { kind: 'touch' }>;

/** A place on the screen, as a fraction of it. */
export type Fraction = { x: number; y: number };

export type Direction = 'up' | 'down' | 'left' | 'right';

/** One finger, down to up. */
export type Stroke = {
  from: Fraction;
  to: Fraction;
  ms: number;
  /** How long it rested before it moved; none: it never did. */
  restedMs?: number;
  /** A second finger came. */
  pinch: boolean;
  /** A scroll wheel or two fingers on a trackpad: a stroke however short. */
  wheel: boolean;
};

export type Gesture =
  | { kind: 'tap' | 'long_press'; at: Fraction; ms: number }
  | { kind: 'swipe'; at: Fraction; direction: Direction }
  | { kind: 'other'; at: Fraction; what: string };

/** A hand on a mouse moves this share of the picture and means nothing by it: about 6 window points across a phone. */
const SLOP = 0.015;
/** A finger held this long is a long press on either system. */
const LONG_MS = 500;
/** One axis this many times the other: a drag along it. */
const AXIS = 1.5;

/** Follows a person's touches, one finger's way at a time. */
export class StrokeReader {
  private down: (Fraction & { at: number }) | undefined;
  private movedAt: number | undefined;
  private pinch = false;

  /** The stroke that this event ends. A wheel's first event may fall off the picture: what follows it is no stroke. */
  feed(e: Touch, now: number): Stroke | undefined {
    if (e.p === 0) {
      this.down = { x: e.x, y: e.y, at: now };
      this.movedAt = undefined;
      this.pinch = false;
    }
    const down = this.down;
    if (!down) return undefined;
    if (e.x2 !== undefined) this.pinch = true;
    const far = Math.abs(e.x - down.x) > SLOP || Math.abs(e.y - down.y) > SLOP;
    if (far && this.movedAt === undefined) this.movedAt = now;
    if (e.p !== 2) return undefined;
    this.down = undefined;
    const wheel = e.wheel === true;
    // a wheel's event with no motion in it did nothing on the device
    if (wheel && e.x === down.x && e.y === down.y) return undefined;
    return {
      from: { x: down.x, y: down.y },
      to: { x: e.x, y: e.y },
      ms: now - down.at,
      ...(this.movedAt !== undefined && { restedMs: this.movedAt - down.at }),
      pinch: this.pinch,
      wheel,
    };
  }
}

/** What a stroke meant, on a screen of this shape. */
export function gestureOf(s: Stroke, size: { w: number; h: number }): Gesture {
  const at = s.from;
  if (s.pinch) return { kind: 'other', at, what: 'pinch' };
  if (s.restedMs === undefined && !s.wheel)
    return { kind: s.ms >= LONG_MS ? 'long_press' : 'tap', at, ms: s.ms };
  if (!s.wheel && (s.restedMs ?? 0) >= LONG_MS)
    return { kind: 'other', at, what: 'a drag after a long press' };
  const dx = (s.to.x - s.from.x) * size.w;
  const dy = (s.to.y - s.from.y) * size.h;
  const across = Math.abs(dx) >= Math.abs(dy);
  if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS * Math.min(Math.abs(dx), Math.abs(dy)))
    return { kind: 'other', at, what: 'a drag along no axis' };
  if (across) return { kind: 'swipe', at, direction: dx < 0 ? 'left' : 'right' };
  return { kind: 'swipe', at, direction: dy < 0 ? 'up' : 'down' };
}
