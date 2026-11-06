import { randomUUID } from 'node:crypto';
import { selectIn, type InputEvent, type Rect, type Screen, type UiElement } from '@appdyno/core';
import type { FlowStep, Recording } from '@appdyno/flows';
import { KEY_USAGES, KEYS, type Key, type Point } from '@appdyno/protocol';
import { keyName } from '../step-schemas.js';
import { type Aim, aimAt, fieldName, pointAim, type Size, stepOf, unrecorded } from './aim.js';
import { type Direction, type Fraction, gestureOf, type Stroke, StrokeReader } from './gestures.js';
import { addSteps, keepRecording } from './shared.js';

/** Two taps this close, in time and place, are one double tap. */
const DOUBLE_MS = 350;
const DOUBLE_NEAR = 0.03;
/** A wheel's notches are a stroke each: this close together, of one direction, they are one swipe. */
const NOTCHES_MS = 400;
/** A finger starting this near an edge is the system's: what it does there has no element. */
const EDGE = 0.02;
/** As `type_text` takes it. */
const MOST_TEXT = 500;
const DEFAULT_LONG_PRESS_MS = 800;
const LONG_PRESS_MS = { least: 100, most: 5_000, step: 100 };
/** A secret with no name of its own: typed, with nothing on the screen to say into what. */
const UNKNOWN_FIELD = 'TYPED';

const DELETE = KEY_USAGES.delete.usage;
const ENTER = KEY_USAGES.enter.usage;
const TAB = KEY_USAGES.tab.usage;

/** What a window's control is pressed as, where it is no key of the device. */
const VIEWS: Record<string, string> = {
  controlCenter: 'control_center',
  notifications: 'notification_center',
  spotlight: 'spotlight',
};

const keyOfButton = (name: string) =>
  VIEWS[name] ?? (KEYS.includes(name as Key) ? keyName(name as Key) : undefined);

const inside = (p: Point, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

const focusOf = (screen: Screen | undefined) => screen?.elements.find((e) => e.focused);

/** A field that holds nothing yet may still say its placeholder. */
const isEmpty = (f: UiElement) => !f.text || f.text === f.placeholder;

/** The smallest scrolling thing holding a point: a swipe there moves it. */
const scrollerAt = (screen: Screen, p: Point) =>
  screen.elements
    .filter((e) => e.scrollable && e.rect && inside(p, e.rect))
    .sort((a, b) => a.rect!.width * a.rect!.height - b.rect!.width * b.rect!.height)[0]?.ref;

const heldFor = (ms: number) => {
  const { least, most, step } = LONG_PRESS_MS;
  const held = Math.round(Math.min(Math.max(ms, least), most) / step) * step;
  return held === DEFAULT_LONG_PRESS_MS ? undefined : held;
};

/** What the writer needs of its window. */
export type WindowStepsPort = {
  /** What a person sees now: called in the same tick as their input, it is the screen they aimed at. */
  seen(): Promise<Screen | undefined>;
  /** The key the device was sent for a keyboard's usage. */
  keyOf(usage: number): Key | undefined;
  /** A read made for this, where no later input will say what the screen came to. */
  fresh(): Promise<Screen | undefined>;
  /** The screen's size in tap units. */
  sizeOf(screen: Screen): Size | undefined;
  keyboardOf(screen: Screen): Rect | undefined;
  /** The recording that takes this now. */
  recording(): Recording | undefined;
  /** A person is told, at that moment. */
  say(note: string): void;
  wrote(r: Recording): void;
};

type Typing = { text: string; submit: boolean; before: Promise<Screen | undefined> };

/**
 * What a person does on a window, as a flow's steps, each on the screen it was done on. Input comes here after it
 * left for the device: this only ever queues work, so that nothing here is in front of a touch.
 */
export function windowSteps(o: WindowStepsPort) {
  const strokes = new StrokeReader();
  let turn: Promise<unknown> = Promise.resolve();
  let before: Promise<Screen | undefined> = Promise.resolve(undefined);
  let typing: Typing | undefined;
  /** The field the last tap landed on. */
  let field: UiElement | undefined;
  let lastTap: { at: Fraction; when: number; index: number; aim: Aim } | undefined;
  let scrolled:
    | { direction: Direction; first: number; count: number; screen: Screen; when: number }
    | undefined;
  /** On-screen keys were tapped, into this field. */
  let keyed: { field: UiElement | undefined } | undefined;
  let lastKey: { key: string; index: number; count: number } | undefined;

  const inTurn = (work: (r: Recording) => Promise<void> | void) => {
    turn = turn
      .then(() => {
        const r = o.recording();
        return r && work(r);
      })
      .catch((e: Error) => o.say(e.message));
  };

  const write = (r: Recording, step: FlowStep | FlowStep[]) => {
    addSteps(r, step);
    o.wrote(r);
  };

  /** The last steps turn out to have been this one. */
  const rewrite = (r: Recording, count: number, step: FlowStep) => {
    r.rewrite(count, step);
    keepRecording(r);
    o.wrote(r);
  };

  const told = (r: Recording, what: string) => {
    write(r, unrecorded(what));
    o.say(`Not a step: ${what}. A replay stops there.`);
  };

  /** Keys tapped on the device's own keyboard are no taps: what they typed is read from the field afterwards. */
  const endKeyed = (r: Recording, after: Screen | undefined) => {
    const k = keyed;
    keyed = undefined;
    if (!k) return;
    const el =
      after?.elements.find((e) => e.ref === k.field?.ref) ?? focusOf(after) ?? k.field ?? undefined;
    if (!el) return told(r, "typing on the device's keyboard, into nothing the screen names");
    // what a secure field holds no read gives: the step needs its name, and the flow's run its value
    const text = el.password ? randomUUID() : el.text;
    if (el.password) r.learnSecret(text!, fieldName(el));
    if (text) write(r, stepOf('type', {}, { text, replace: true }));
    o.say("Typed on the device's keyboard: read from the field. Its Return key is not seen.");
  };

  const onTyped = async (r: Recording, t: Typing, after: Promise<Screen | undefined>) => {
    if (!t.text) return;
    const seen = [field, focusOf(await t.before), focusOf(await after)];
    const secure = seen.find((f) => f?.password);
    if (secure) r.learnSecret(t.text, fieldName(secure));
    else if (!seen.some(Boolean)) {
      // a field no read shows may be a password's: the file holds a name, and a run is given the text
      r.learnSecret(t.text, UNKNOWN_FIELD);
      o.say(
        `Typed into nothing the screen names: written as \${${UNKNOWN_FIELD}}, not as its text`,
      );
    }
    const parts = Array.from({ length: Math.ceil(t.text.length / MOST_TEXT) }, (_, i) =>
      t.text.slice(i * MOST_TEXT, (i + 1) * MOST_TEXT),
    );
    // into an empty field, what a person meant is that it says this: a replay finds it as a last run left it
    const known = seen.find(Boolean);
    const emptied = !!known && isEmpty(known);
    write(
      r,
      (secure ? [t.text] : parts).map((text, i, all) =>
        stepOf(
          'type',
          {},
          {
            text,
            replace: (emptied && i === 0) || undefined,
            submit: (t.submit && i === all.length - 1) || undefined,
          },
        ),
      ),
    );
  };

  /** The typing so far is a step, however it ended: `after` is what the screen came to. */
  const endTyping = (after: Promise<Screen | undefined>) => {
    const t = typing;
    typing = undefined;
    if (t) inTurn((r) => onTyped(r, t, after));
  };

  /** Scrolling to what came next is what was meant: a swipe holds for one size of screen, an element for any. */
  const reached = (r: Recording, a: Aim) => {
    const s = scrolled;
    scrolled = undefined;
    if (!s || !a.selector || a.flags?.includes('ambiguous')) return;
    if (r.state.steps.length !== s.first + s.count) return;
    if (selectIn(s.screen.list, a.selector).length > 0) return;
    const direction = s.direction === 'up' ? undefined : s.direction;
    rewrite(r, s.count, stepOf('scroll_to', { selector: a.selector }, { direction }));
  };

  const coordinatesTold = (a: Aim) => {
    if (a.args) o.say('Written as coordinates: nothing names that place.');
  };

  const onTap = (r: Recording, a: Aim, at: Fraction, when: number, screen: Screen) => {
    const was = lastTap;
    lastTap = undefined;
    const twice =
      was &&
      was.index === r.state.steps.length - 1 &&
      when - was.when <= DOUBLE_MS &&
      Math.hypot(at.x - was.at.x, at.y - was.at.y) <= DOUBLE_NEAR;
    if (twice) return rewrite(r, 1, stepOf('double_tap', was.aim));
    const el = a.element && screen.elements.find((e) => e.ref === a.element!.ref);
    field = el?.editable ? el : undefined;
    coordinatesTold(a);
    reached(r, a);
    write(r, stepOf('tap', a));
    lastTap = { at, when, index: r.state.steps.length - 1, aim: a };
  };

  const onSwipe = (
    r: Recording,
    g: { at: Fraction; direction: Direction },
    p: Point,
    when: number,
    screen: Screen,
    size: Size,
  ) => {
    const s = scrolled;
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
    coordinatesTold(a);
    write(r, stepOf('swipe', a, { direction: g.direction }));
    const index = r.state.steps.length - 1;
    if (s && same && s.first + s.count === index) {
      s.count++;
      s.when = when;
    } else scrolled = { direction: g.direction, first: index, count: 1, screen, when };
  };

  const onStroke = async (
    r: Recording,
    stroke: Stroke,
    when: number,
    was: Promise<Screen | undefined>,
  ) => {
    const screen = await was;
    const size = screen && o.sizeOf(screen);
    if (!screen || !size) return told(r, 'a touch on a screen not read');
    const g = gestureOf(stroke, size);
    const p = { x: Math.round(g.at.x * size.w), y: Math.round(g.at.y * size.h) };
    const keyboard = o.keyboardOf(screen);
    if (keyboard && inside(p, keyboard)) {
      if (g.kind === 'tap') keyed ??= { field: field ?? focusOf(screen) };
      else told(r, "a gesture on the device's keyboard");
      return;
    }
    endKeyed(r, screen);
    if (g.kind === 'swipe') return onSwipe(r, g, p, when, screen, size);
    if (g.kind === 'other') return told(r, g.what);
    const a = aimAt(screen, p, size);
    if (g.kind === 'tap') return onTap(r, a, g.at, when, screen);
    coordinatesTold(a);
    reached(r, a);
    write(r, stepOf('long_press', a, { durationMs: heldFor(g.ms) }));
  };

  const onKey = (r: Recording, usage: number) => {
    const sent = o.keyOf(usage);
    if (usage === TAB) field = undefined;
    if (!sent) return told(r, 'a key with no step');
    const key = keyName(sent);
    const last = lastKey;
    if (last?.key === key && last.index === r.state.steps.length - 1) {
      last.count++;
      return rewrite(r, 1, stepOf('press_key', {}, { key, count: last.count }));
    }
    write(r, stepOf('press_key', {}, { key }));
    lastKey = { key, index: r.state.steps.length - 1, count: 1 };
  };

  const onButton = (r: Recording, name: string) => {
    const key = keyOfButton(name);
    if (!key)
      return told(
        r,
        name.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`),
      );
    write(r, stepOf('press_key', {}, { key }));
  };

  return {
    /** A person's input, as it left for the device. */
    input(e: InputEvent, now: number) {
      switch (e.kind) {
        case 'touch': {
          if (e.p === 0) {
            before = o.seen();
            endTyping(before);
          }
          const stroke = strokes.feed(e, now);
          const was = before;
          if (stroke) inTurn((r) => onStroke(r, stroke, now, was));
          return;
        }
        case 'text':
          typing ??= { text: '', submit: false, before: o.seen() };
          typing.text += e.s;
          return;
        case 'key': {
          if (e.state !== 1) return;
          if (typing && e.usage === DELETE) {
            typing.text = Array.from(typing.text).slice(0, -1).join('');
            return;
          }
          if (typing && e.usage === ENTER) {
            typing.submit = true;
            return endTyping(o.seen());
          }
          const after = o.seen();
          endTyping(after);
          inTurn(async (r) => {
            endKeyed(r, await after);
            onKey(r, e.usage);
          });
          return;
        }
        case 'button': {
          const after = o.seen();
          endTyping(after);
          inTurn(async (r) => {
            endKeyed(r, await after);
            onButton(r, e.name);
          });
        }
      }
    },

    /** Something done from the window that is no input: an app launched from the Apps pane, an assertion. */
    add(step: FlowStep, aim?: Aim) {
      const after = o.seen();
      endTyping(after);
      inTurn(async (r) => {
        endKeyed(r, await after);
        if (aim) reached(r, aim);
        write(r, step);
      });
    },

    /** Whatever is held goes down, read from the screen as it is. */
    async finish() {
      if (typing || keyed) {
        const after = o.fresh();
        endTyping(after);
        inTurn(async (r) => endKeyed(r, await after));
      }
      await turn;
    },
  };
}
