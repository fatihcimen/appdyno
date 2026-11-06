import type { InputEvent } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { gestureOf, StrokeReader, type Stroke } from '../src/gestures.js';

const SIZE = { w: 400, h: 800 };
type Touch = Extract<InputEvent, { kind: 'touch' }>;

/** Each `[phase, x, y, ms]` as a window sends it; the stroke the last ended. */
const stroke = (events: [0 | 1 | 2, number, number, number][], over: Partial<Touch> = {}) => {
  const reader = new StrokeReader();
  let done: Stroke | undefined;
  for (const [p, x, y, ms] of events)
    done = reader.feed({ kind: 'touch', p, x, y, ...over }, 1_000 + ms) ?? done;
  return done;
};
const kindOf = (...a: Parameters<typeof stroke>) => gestureOf(stroke(...a)!, SIZE);

describe("a window's strokes", () => {
  it('reads a click as a tap, a hand that moved a little included', () => {
    const g = kindOf([
      [0, 0.5, 0.5, 0],
      [1, 0.505, 0.504, 40],
      [2, 0.505, 0.504, 80],
    ]);
    expect(g).toEqual({ kind: 'tap', at: { x: 0.5, y: 0.5 }, ms: 80 });
  });

  it('reads a hold as a long press, for as long as it was held', () => {
    expect(
      kindOf([
        [0, 0.5, 0.5, 0],
        [2, 0.5, 0.5, 1_300],
      ]),
    ).toMatchObject({ kind: 'long_press', ms: 1_300 });
  });

  it.each([
    ['up', 0.5, 0.2],
    ['down', 0.5, 0.8],
    ['left', 0.1, 0.5],
    ['right', 0.9, 0.5],
  ])('reads a drag %s by where the finger went', (direction, x, y) => {
    expect(
      kindOf([
        [0, 0.5, 0.5, 0],
        [1, x, y, 100],
        [2, x, y, 200],
      ]),
    ).toMatchObject({ kind: 'swipe', direction });
  });

  it('judges a drag by the screen, not the fractions: a tall screen makes its height count', () => {
    // a third of the width against a quarter of the height is further down than across
    expect(
      kindOf([
        [0, 0.3, 0.3, 0],
        [1, 0.45, 0.55, 100],
        [2, 0.45, 0.55, 200],
      ]),
    ).toMatchObject({ kind: 'swipe', direction: 'down' });
  });

  it('has no step for a drag along neither axis, or one after a long press', () => {
    expect(
      kindOf([
        [0, 0.2, 0.2, 0],
        [1, 0.6, 0.4, 100],
        [2, 0.6, 0.4, 200],
      ]),
    ).toMatchObject({ kind: 'other', what: 'a drag along no axis' });
    expect(
      kindOf([
        [0, 0.5, 0.5, 0],
        [1, 0.5, 0.7, 700],
        [2, 0.5, 0.7, 900],
      ]),
    ).toMatchObject({ kind: 'other', what: 'a drag after a long press' });
  });

  it('knows a pinch by its second finger', () => {
    expect(
      kindOf(
        [
          [0, 0.4, 0.5, 0],
          [2, 0.4, 0.5, 300],
        ],
        { x2: 0.6, y2: 0.5 },
      ),
    ).toMatchObject({ kind: 'other', what: 'pinch' });
  });

  it("never takes a wheel's notch for a tap, however small on a tall window", () => {
    expect(
      kindOf(
        [
          [0, 0.5, 0.5, 0],
          [1, 0.5, 0.49, 0],
          [2, 0.5, 0.49, 0],
        ],
        { wheel: true },
      ),
    ).toMatchObject({ kind: 'swipe', direction: 'up' });
  });

  it('sees no stroke in what a wheel sent with no motion, or a move with no finger down', () => {
    expect(
      stroke(
        [
          [0, 0.5, 0.5, 0],
          [2, 0.5, 0.5, 0],
        ],
        { wheel: true },
      ),
    ).toBeUndefined();
    expect(
      stroke([
        [1, 0.5, 0.5, 0],
        [2, 0.5, 0.6, 10],
      ]),
    ).toBeUndefined();
  });
});
