import { selectIn, type Rect, type Screen } from '@appdyno/core';
import type { Recording } from '@appdyno/flows';
import type { Point } from '@appdyno/protocol';
import { type Direction, type Fraction, gestureOf, type Stroke } from './gestures.js';
import type { TypingSteps } from './window-typing.js';
import type { StepWriter, WindowStepsPort } from './window-writer.js';
import { type Aim, aimAt, pointAim, type Size, stepOf } from '@appdyno/ops';

/** Two taps this close, in time and place, are one double tap. */
const DOUBLE_MS = 350;
const DOUBLE_NEAR = 0.03;
/** A wheel's notches are a stroke each: this close together, of one direction, they are one swipe. */
const NOTCHES_MS = 400;
/** A finger starting this near an edge is the system's: what it does there has no element. */
const EDGE = 0.02;
const DEFAULT_LONG_PRESS_MS = 800;
const LONG_PRESS_MS = { least: 100, most: 5_000, step: 100 };

const inside = (p: Point, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/** The smallest scrolling thing holding a point: a swipe there moves it. */
const scrollerAt = (screen: Screen, p: Point) =>
  screen.elements
    .flatMap((e) =>
      e.scrollable && e.rect && inside(p, e.rect) ? [{ ref: e.ref, rect: e.rect }] : [],
    )
    .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0]?.ref;

const heldFor = (ms: number) => {
  const { least, most, step } = LONG_PRESS_MS;
  const held = Math.round(Math.min(Math.max(ms, least), most) / step) * step;
  return held === DEFAULT_LONG_PRESS_MS ? undefined : held;
};

/** What a person's strokes on the screen come to: taps, a double tap of two, a swipe, a scroll to what came next. */
export class TouchSteps {
  private lastTap: { at: Fraction; when: number; index: number; aim: Aim } | undefined;
  private scrolled:
    | { direction: Direction; first: number; count: number; screen: Screen; when: number }
    | undefined;

  constructor(
    private readonly o: WindowStepsPort,
    private readonly steps: StepWriter,
    private readonly typing: TypingSteps,
  ) {}

  /** Scrolling to what came next is what was meant: a swipe holds for one size of screen, an element for any. */
  reached(r: Recording, a: Aim) {
    const s = this.scrolled;
    this.scrolled = undefined;
    if (!s || !a.selector || a.flags?.includes('ambiguous')) return;
    if (r.state.steps.length !== s.first + s.count) return;
    if (selectIn(s.screen.list, a.selector).length > 0) return;
    const direction = s.direction === 'up' ? undefined : s.direction;
    this.steps.rewrite(r, s.count, stepOf('scroll_to', { selector: a.selector }, { direction }));
  }

  private onTap(r: Recording, a: Aim, at: Fraction, when: number, screen: Screen) {
    const was = this.lastTap;
    this.lastTap = undefined;
    const twice =
      was?.index === r.state.steps.length - 1 &&
      when - was.when <= DOUBLE_MS &&
      Math.hypot(at.x - was.at.x, at.y - was.at.y) <= DOUBLE_NEAR;
    if (twice) {
      this.steps.rewrite(r, 1, stepOf('double_tap', was.aim));
      return;
    }
    const { element } = a;
    const el = element && screen.elements.find((e) => e.ref === element.ref);
    this.typing.field = el?.editable ? el : undefined;
    this.steps.coordinatesTold(a);
    this.reached(r, a);
    this.steps.write(r, stepOf('tap', a));
    this.lastTap = { at, when, index: r.state.steps.length - 1, aim: a };
  }

  private onSwipe(
    r: Recording,
    g: { at: Fraction; direction: Direction },
    p: Point,
    when: number,
    screen: Screen,
    size: Size,
  ) {
    const s = this.scrolled;
    const same = s?.direction === g.direction;
    if (s && same && when - s.when <= NOTCHES_MS) {
      s.when = when;
      return;
    }
    const edge = Math.min(g.at.x, g.at.y, 1 - g.at.x, 1 - g.at.y) < EDGE;
    const middle = { x: size.w / 2, y: size.h / 2 };
    // a swipe from the middle does the same: the file then holds for any screen
    const needsNoTarget = !edge && scrollerAt(screen, p) === scrollerAt(screen, middle);
    const a = needsNoTarget ? {} : edge ? pointAim(p, size) : aimAt(screen, p, size);
    this.steps.coordinatesTold(a);
    this.steps.write(r, stepOf('swipe', a, { direction: g.direction }));
    const index = r.state.steps.length - 1;
    if (s && same && s.first + s.count === index) {
      s.count++;
      s.when = when;
    } else this.scrolled = { direction: g.direction, first: index, count: 1, screen, when };
  }

  async stroke(
    r: Recording,
    stroke: Stroke,
    when: number,
    was: Promise<Screen | undefined>,
  ): Promise<void> {
    const screen = await was;
    const size = screen && this.o.sizeOf(screen);
    if (!screen || !size) {
      this.steps.told(r, 'a touch on a screen not read');
      return;
    }
    const g = gestureOf(stroke, size);
    const p = { x: Math.round(g.at.x * size.w), y: Math.round(g.at.y * size.h) };
    const keyboard = this.o.keyboardOf(screen);
    if (keyboard && inside(p, keyboard)) {
      if (g.kind === 'tap') this.typing.keyTapped(screen);
      else this.steps.told(r, "a gesture on the device's keyboard");
      return;
    }
    this.typing.endKeyed(r, screen);
    if (g.kind === 'swipe') {
      this.onSwipe(r, g, p, when, screen, size);
      return;
    }
    if (g.kind === 'other') {
      this.steps.told(r, g.what);
      return;
    }
    const a = aimAt(screen, p, size);
    if (g.kind === 'tap') {
      this.onTap(r, a, g.at, when, screen);
      return;
    }
    this.steps.coordinatesTold(a);
    this.reached(r, a);
    this.steps.write(r, stepOf('long_press', a, { durationMs: heldFor(g.ms) }));
  }
}
