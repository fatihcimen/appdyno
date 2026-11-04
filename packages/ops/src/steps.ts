import {
  type Selector as SelectorOf,
  type ScreenElement,
  nearest,
  selectIn,
  type Screen,
  attributesOf,
  pause,
  reportProgress,
  type ActOptions,
} from '@appdyno/core';
import type { ActResult, TextResult } from '@appdyno/protocol';
import { z } from 'zod';
import { type Answers, SETTLE, type ReadMode } from './answers.js';
import type { ServerContext } from './context.js';
import type { Session } from './session.js';
import { ToolError } from './tool.js';
import { Check, Step, Direction } from './step-schemas.js';
import { dragPath, swipeLine } from './gesture-paths.js';

export const STALE = 'stale ref, read the screen again';

const WIRE_KEY = {
  back: 'back',
  enter: 'enter',
  home: 'home',
  delete: 'delete',
  tab: 'tab',
  app_switch: 'appSwitch',
  volume_up: 'volumeUp',
  volume_down: 'volumeDown',
  power: 'power',
  lock: 'lock',
} as const;

/** These leave the app, as the home key does. */
const LEAVES_APP = new Set(['home', 'app_switch', 'power', 'lock']);

/** The screen goes dark: nothing to wait for or read. */
const DARKENS = new Set(['power', 'lock']);

/** How long a selector with no match waits for its element, as a screen may still be coming. */
const NO_MATCH_WAIT_MS = 1_500;

/** A scroll's finger travels this share of the list either way from its middle. */
const SCROLL_REACH = 0.35;

const DRAG_HOLD_MS = 150;

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

/** The selector in flat arguments (the tools that only look at the screen take it that way). */
const selectorOf = (a: SelectorOf): SelectorOf | undefined =>
  a.text || a.id || a.role
    ? {
        ...(a.text && { text: a.text }),
        ...(a.id && { id: a.id }),
        ...(a.role && { role: a.role }),
        ...(a.index !== undefined && { index: a.index }),
      }
    : undefined;

const showSelector = (sel: SelectorOf) =>
  Object.entries(sel)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');

type Judged = SelectorOf & {
  ref?: string;
  check: z.infer<typeof Check>;
  equals?: string;
  expect: boolean;
};

/** What every step passes through on its way to the device (the recorder). */
export type StepSeam = <T>(s: Session, st: Step, run: () => Promise<T>) => Promise<T>;

/** One step's device call and the action around it, shared by the tools that act on a target. */
export function stepsFor(ctx: ServerContext, { act, clean }: Answers, through: StepSeam) {
  const policy = ctx.policy;
  const line = (e: ScreenElement) =>
    `${e.ref} ${e.role} ${JSON.stringify(clean(e.label || e.id || ''))} ${e.x},${e.y}`;
  const offer = (list: ScreenElement[], want?: string) => {
    const near = nearest(list, want).map(line);
    return near.length > 0 ? `; nearest: ${near.join('; ')}` : '';
  };

  /** One element of a selector's matches, or a refusal listing them. */
  const pick = (hits: ScreenElement[], sel: SelectorOf): ScreenElement => {
    // a control and its own text inside it, with the same words (an Android row), are one target
    const inside = (a: ScreenElement, b: ScreenElement) =>
      a !== b &&
      a.rect.x >= b.rect.x &&
      a.rect.y >= b.rect.y &&
      a.rect.x + a.rect.width <= b.rect.x + b.rect.width &&
      a.rect.y + a.rect.height <= b.rect.y + b.rect.height;
    const outer = hits.filter((a) => !hits.some((b) => inside(a, b)));
    const hit =
      sel.index === undefined ? (outer.length === 1 ? outer[0] : undefined) : hits[sel.index];
    if (hit) return hit;
    throw new ToolError(
      `${hits.length} elements match ${showSelector(sel)}: ${hits.slice(0, 10).map(line).join('; ')}`,
      'AMBIGUOUS',
      'give the selector an index, or use a ref',
    );
  };

  /** A selector on a fresh read; no match waits a moment, as the screen may still be coming. */
  const resolve = async (s: Session, sel: SelectorOf): Promise<ScreenElement> => {
    const { screen, met } = await s.until(
      (x) => selectIn(x.list, sel).length > 0,
      NO_MATCH_WAIT_MS,
    );
    if (!screen) throw new ToolError('the screen could not be read', 'NOT_FOUND');
    if (!met)
      throw new ToolError(
        `no element matches ${showSelector(sel)} after ${NO_MATCH_WAIT_MS} ms${offer(screen.list, sel.text ?? sel.id)}`,
        'NOT_FOUND',
        'read the screen, or use scroll_to if it may be further along a list',
      );
    return pick(selectIn(screen.list, sel), sel);
  };

  /** The point of a ref (on the device's current screen), a selector or x,y. */
  const target = async (
    s: Session,
    a: { ref?: string; x?: number; y?: number; selector?: SelectorOf },
    patient = false,
  ) => {
    if (a.ref) {
      const has = (x: Screen | undefined) => x?.list.find((e) => e.ref === a.ref);
      const e =
        has(await s.current()) ??
        (patient ? has((await s.until((x) => !!has(x), NO_MATCH_WAIT_MS)).screen) : undefined);
      if (!e) throw new ToolError(`${STALE}: ${a.ref} is not on this screen`, 'STALE');
      return { point: { x: e.x, y: e.y }, name: `${a.ref} ${JSON.stringify(clean(e.label))}` };
    }
    if (a.selector) {
      const e = await resolve(s, a.selector);
      return { point: { x: e.x, y: e.y }, name: `${e.ref} ${JSON.stringify(clean(e.label))}` };
    }
    if (a.x === undefined || a.y === undefined)
      throw new ToolError('give a ref, a selector, or x and y');
    return { point: { x: a.x, y: a.y }, name: `${a.x},${a.y}` };
  };

  const windowSize = async (s: Session) => {
    const w =
      (await s.current()).window ??
      (s.device.hello && { w: s.device.hello.screen.w, h: s.device.hello.screen.h });
    if (!w) throw new ToolError('the screen size is unknown: give x, y and distance');
    return w;
  };

  /** Whether a check holds on this screen, and why or why not in words. */
  const judge = (screen: Screen, a: Judged): { pass: boolean; why: string } => {
    const sel = selectorOf(a) ?? {};
    const what = a.ref ?? showSelector(sel);
    const all = a.ref ? screen.list.filter((e) => e.ref === a.ref) : selectIn(screen.list, sel);
    const hits = sel.index === undefined ? all : all.slice(sel.index, sel.index + 1);
    const missing = `${what} is not on the screen${offer(screen.list, sel.text ?? sel.id)}`;
    if (a.check === 'exists' || a.check === 'absent') {
      const want = a.check === 'absent' ? !a.expect : a.expect;
      if (hits.length > 0 === want)
        return { pass: true, why: `${what} is ${want ? 'on' : 'not on'} the screen` };
      return {
        pass: false,
        why: want ? missing : `${what} is on the screen: ${hits.slice(0, 5).map(line).join('; ')}`,
      };
    }
    if (hits.length !== 1)
      return {
        pass: false,
        why:
          hits.length === 0
            ? missing
            : `${hits.length} elements match ${what}: ${hits.slice(0, 5).map(line).join('; ')}`,
      };
    const at = attributesOf(screen.elements, hits[0]!);
    if (a.check === 'text') {
      if (a.equals === undefined) throw new ToolError('check text needs equals');
      return at.text === a.equals || at.value === a.equals
        ? { pass: true, why: `${what} reads ${JSON.stringify(clean(a.equals))}` }
        : {
            pass: false,
            why: `${what} reads ${JSON.stringify(clean(at.value ?? at.text))}, not ${JSON.stringify(clean(a.equals))}`,
          };
    }
    return {
      pass: at[a.check] === a.expect,
      why: `${what} is ${at[a.check] ? '' : 'not '}${a.check}`,
    };
  };

  /** A check on a fresh read, given `timeoutMs` to come true; a refusal when it does not. */
  const checkNow = async (s: Session, a: Judged & { timeoutMs: number }) => {
    if (!a.ref && !selectorOf(a)) throw new ToolError('give a ref, text, id or role');
    const { screen } = await s.until((x) => judge(x, a).pass, a.timeoutMs);
    if (!screen) throw new ToolError('the screen could not be read', 'NOT_FOUND');
    const v = judge(screen, a);
    if (!v.pass) throw new ToolError(`check failed: ${v.why}`, 'CHECK_FAILED');
    return { screen, done: `check passed: ${v.why}` };
  };

  /** Waits for an element to show or go, on the device where its agent can. */
  const waitFor = async (
    s: Session,
    a: SelectorOf & { ref?: string; gone: boolean; timeoutMs: number },
  ) => {
    const sel = selectorOf(a);
    if (!a.ref && !sel) throw new ToolError('give text, id, role or ref');
    const found = (x: Screen) =>
      (a.ref ? x.list.filter((e) => e.ref === a.ref) : selectIn(x.list, sel!))[sel?.index ?? 0];
    const { screen, met } = await s.until((x) => !!found(x) !== a.gone, a.timeoutMs);
    if (!screen) throw new ToolError('the screen could not be read: nothing to look in');
    return { screen, met, found: found(screen) };
  };

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
        return { r: last, done: `found ${line(pick(hits, a.selector))} after ${swipes} swipes` };
      if (swipes >= a.maxSwipes)
        throw new ToolError(
          `${what} not found after ${swipes} swipes; the list can still move${offer(screen.list, a.selector.text)}`,
          'NOT_FOUND',
          'raise maxSwipes',
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
        );
      screen = next;
    }
  };

  /** One step's device call. `patient`: in a sequence, a ref may need a moment to come. */
  const step = (s: Session, st: Step, opts: ActOptions, patient = false) =>
    through(s, st, () => call(s, st, opts, patient));

  const call = async (
    s: Session,
    st: Step,
    opts: ActOptions,
    patient: boolean,
  ): Promise<{ r: ActResult | TextResult; done: string }> => {
    const treeIfAsked = (screen: Screen): ActResult =>
      opts.read === 'tree' ? { tree: screen.tree } : {};
    switch (st.action) {
      case 'tap': {
        const t = await target(s, st, patient);
        return { r: await s.device.tap(t.point, opts), done: `tapped ${t.name}` };
      }
      case 'long_press': {
        const t = await target(s, st, patient);
        return {
          r: await s.device.longPress(t.point, st.durationMs ?? 800, opts),
          done: `long-pressed ${t.name}`,
        };
      }
      case 'double_tap': {
        const t = await target(s, st, patient);
        return {
          r: await s.device.act({ kind: 'doubleTap', ...t.point }, opts),
          done: `double-tapped ${t.name}`,
        };
      }
      case 'drag': {
        const from = await target(s, st, patient);
        const to = await target(s, st.to);
        return {
          r: await s.device.act(
            {
              kind: 'gesture',
              pointers: [dragPath(from.point, to.point, st.durationMs ?? 500, DRAG_HOLD_MS)],
            },
            opts,
          ),
          done: `dragged ${from.name} to ${to.name}`,
        };
      }
      case 'swipe': {
        const start = st.ref || st.selector ? (await target(s, st, patient)).point : undefined;
        const { from, to } = swipeLine(await windowSize(s), { ...st, ...start });
        return {
          r: await s.device.swipe(from, to, st.durationMs ?? 300, opts),
          done: `swiped (${st.direction})`,
        };
      }
      case 'type_text': {
        const at =
          st.ref || st.selector || st.x !== undefined
            ? (await target(s, st, patient)).point
            : undefined;
        const r = await s.device.typeText(st.text, {
          ...(at && { at }),
          replace: st.replace ?? false,
          submit: st.submit ?? false,
          ...opts,
        });
        // iOS takes keys with no field reporting the focus (a hidden field does not): with no keyboard, nothing took them
        if (!at && r.verified === false && r.tree && !s.device.platformScreen.keyboardOpen(r.tree))
          throw new ToolError(
            'no editable field has the focus: tap the field first (or give type_text a ref)',
            'NO_FOCUS',
          );
        // never the text itself (it may be a phone number or a code)
        return {
          r,
          done: `typed (${Array.from(st.text).length} characters${st.submit ? ', submitted' : ''}${r.verified === false ? ', the field read back holds other text' : r.verified === undefined ? ', not read back' : ''})`,
        };
      }
      case 'press_key': {
        if (LEAVES_APP.has(st.key) && !policy.allowHome)
          throw new ToolError(`${st.key} is off on this server: the app may not be left`);
        const dark = DARKENS.has(st.key);
        return {
          r: await s.device.key(WIRE_KEY[st.key], dark ? { settle: false, read: 'none' } : opts),
          done: `pressed ${st.key}${dark ? ' (the screen was not read: it may be dark)' : ''}`,
        };
      }
      case 'wait_for': {
        const w = await waitFor(s, st);
        const what = st.ref ?? showSelector(selectorOf(st) ?? {});
        if (!w.met)
          throw new ToolError(
            `${what} ${st.gone ? 'still there' : 'not shown'} after ${st.timeoutMs} ms`,
            'TIMEOUT',
          );
        return { r: treeIfAsked(w.screen), done: `${what} ${st.gone ? 'gone' : 'shown'}` };
      }
      case 'assert': {
        const c = await checkNow(s, st);
        return { r: treeIfAsked(c.screen), done: c.done };
      }
      case 'scroll_to':
        return scrollTo(s, st);
    }
  };

  const one = async (s: Session, st: Step, read: ReadMode) => {
    let done = '';
    return act(
      s,
      read,
      async (o) => {
        const x = await step(s, st, o);
        done = x.done;
        return x.r;
      },
      () => done,
    );
  };

  return { target, windowSize, step, one, checkNow, waitFor, holdsStill, line };
}

export type Steps = ReturnType<typeof stepsFor>;
