import { motionText, movedIn, watchScreen } from './watch.js';
import {
  type Selector as SelectorOf,
  type ScreenElement,
  nearest,
  selectIn,
  type Screen,
  attributesOf,
  type ActOptions,
} from '@appdyno/core';
import type { ActResult, Point, TextResult } from '@appdyno/protocol';
import { z } from 'zod';
import type { Answers, ReadMode } from './answers.js';
import { noteTouch } from './activity.js';
import type { ServerContext } from './context.js';
import type { Session } from './session.js';
import { ToolError } from './tool.js';
import { Check, Step, keyPress, showSelector, viewNamed } from './step-schemas.js';
import { scrollingFor } from './scroll.js';
import { dragPath, swipeLine } from './gesture-paths.js';

export const STALE = 'stale ref, read the screen again';

/** These leave the app, as the home key does. */
const LEAVES_APP = new Set(['home', 'appSwitch', 'power', 'lock', 'siri']);

/** A keyboard's way to the same: to the home screen, the switcher and search. */
const SHORTCUT_LEAVES = new Set(['h', 'tab', 'space']);

/** The screen goes dark, or to a system sheet with no window to read: nothing to wait for. */
const NOTHING_TO_READ = new Set(['power', 'lock', 'siri', 'mute']);

/**
 * What is pressed with no look first: the way out of such a sheet, what opens one over itself, and what acts on the
 * screen's power, as a look at a dark screen wakes it and the key would then put it back.
 */
const NEEDS_NO_LOOK = new Set(['home', 'mute', 'power', 'lock']);

/** How long a selector with no match waits for its element, as a screen may still be coming. */
export const NO_MATCH_WAIT_MS = 1_500;

const DRAG_HOLD_MS = 150;

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

type Judged = SelectorOf & {
  ref?: string;
  check: z.infer<typeof Check>;
  equals?: string;
  expect: boolean;
};

/** What every step passes through on its way to the device (the recorder). */
export type StepSeam = <T>(s: Session, st: Step, run: () => Promise<T>) => Promise<T>;

/** Only these touch nothing. */
const LOOKS_ONLY = new Set<Step['action']>(['wait_for', 'assert']);
/** How long an `assert` watches with no time of its own. */
const WATCH_CHECK_MS = 2_000;

/** One step's device call and the action around it, shared by the tools that act on a target. */
export function stepsFor(
  ctx: ServerContext,
  { act, clean, settleRead }: Answers,
  through: StepSeam,
) {
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
        has(await s.justNow()) ??
        (patient ? has((await s.until((x) => !!has(x), NO_MATCH_WAIT_MS)).screen) : undefined);
      if (!e) throw new ToolError(`${STALE}: ${a.ref} is not on this screen`, 'STALE');
      return { point: { x: e.x, y: e.y }, name: `${a.ref} ${JSON.stringify(clean(e.label))}` };
    }
    if (a.selector) {
      const e = await resolve(s, a.selector);
      return { point: { x: e.x, y: e.y }, name: `${e.ref} ${JSON.stringify(clean(e.label))}` };
    }
    if (a.x === undefined || a.y === undefined)
      throw new ToolError('give a ref, a selector, or x and y', 'INVALID_ARGUMENT');
    return { point: { x: a.x, y: a.y }, name: `${a.x},${a.y}` };
  };

  const windowSize = async (s: Session) => {
    const w =
      (await s.current()).window ??
      (s.device.hello && { w: s.device.hello.screen.w, h: s.device.hello.screen.h });
    if (!w)
      throw new ToolError('the screen size is unknown: give x, y and distance', 'INVALID_ARGUMENT');
    return w;
  };

  /**
   * A point past the screen's edge reaches nothing, and the answer would still say it was made. Measured by
   * the larger of what the tree shows and what the device said when opened: a phone turned since, or two apps
   * side by side, make either one too small alone, and a point on the screen is never refused.
   */
  const onTheScreen = async (s: Session, points: Partial<Point>[]) => {
    const named = points.filter((p) => p.x !== undefined || p.y !== undefined);
    if (named.length === 0) return;
    const known = [(await s.current()).window, s.device.hello?.screen].filter(
      (z) => z !== undefined,
    );
    if (known.length === 0) return;
    const w = Math.max(...known.map((z) => z.w));
    const h = Math.max(...known.map((z) => z.h));
    const off = named.find((p) => (p.x ?? 0) >= w || (p.y ?? 0) >= h);
    if (off)
      throw new ToolError(
        `${off.x ?? ''},${off.y ?? ''} is off the screen, which is ${w}x${h}`,
        'INVALID_ARGUMENT',
        undefined,
        false,
      );
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
      if (a.equals === undefined)
        throw new ToolError('check text needs equals', 'INVALID_ARGUMENT');
      return at.text === a.equals || at.value === a.equals
        ? { pass: true, why: `${what} reads ${JSON.stringify(clean(a.equals))}` }
        : {
            pass: false,
            why: `${what} reads ${JSON.stringify(clean(at.value ?? at.text))}, not ${JSON.stringify(clean(a.equals))}`,
          };
    }
    const state = a.check as 'enabled' | 'checked' | 'focused';
    return {
      pass: at[state] === a.expect,
      why: `${what} is ${at[state] ? '' : 'not '}${state}`,
    };
  };

  /** Over `timeoutMs`, in the element named or anywhere; `expect: false` says it must keep still. */
  const movesNow = async (s: Session, a: Judged & { timeoutMs: number }) => {
    const m = await watchScreen(ctx, s, a.timeoutMs || WATCH_CHECK_MS, false);
    const screen = await s.current();
    const sel = selectorOf(a);
    const element = a.ref
      ? screen.list.find((e) => e.ref === a.ref)
      : sel && selectIn(screen.list, sel)[sel.index ?? 0];
    if ((a.ref || sel) && !element)
      throw new ToolError('check failed: nothing to watch by those words', 'CHECK_FAILED');
    const box = element && {
      x: element.rect.x,
      y: element.rect.y,
      w: element.rect.width,
      h: element.rect.height,
    };
    const moved = movedIn(m, s.device.hello!.screen, box, !a.expect);
    const said = motionText(m, s.device.hello!.screen);
    if (moved !== a.expect) throw new ToolError(`check failed: ${said}`, 'CHECK_FAILED');
    return { screen, done: `check passed: ${said}` };
  };

  /** A check on a fresh read, given `timeoutMs` to come true; a refusal when it does not. */
  const checkNow = async (s: Session, a: Judged & { timeoutMs: number }) => {
    if (a.check === 'moves') return movesNow(s, a);
    if (!a.ref && !selectorOf(a))
      throw new ToolError('give a ref, text, id or role', 'INVALID_ARGUMENT');
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
    if (!a.ref && !sel) throw new ToolError('give text, id, role or ref', 'INVALID_ARGUMENT');
    const found = (x: Screen) =>
      (a.ref ? x.list.filter((e) => e.ref === a.ref) : selectIn(x.list, sel!))[sel?.index ?? 0];
    const { screen, met } = await s.until((x) => !!found(x) !== a.gone, a.timeoutMs);
    if (!screen)
      throw new ToolError('the screen could not be read: nothing to look in', 'NOT_FOUND');
    return { screen, met, found: found(screen) };
  };

  const { holdsStill, scrollTo, scrollBy } = scrollingFor({ windowSize, line, pick, offer });

  /** One step's device call. `patient`: in a sequence, a ref may need a moment to come. */
  const step = (s: Session, st: Step, opts: ActOptions, patient = false) =>
    through(s, st, async () => {
      if (!LOOKS_ONLY.has(st.action) && !(st.action === 'press_key' && NEEDS_NO_LOOK.has(st.key)))
        await s.beforeTouch();
      return call(s, st, opts, patient);
    });

  const call = async (
    s: Session,
    st: Step,
    opts: ActOptions,
    patient: boolean,
  ): Promise<{ r: ActResult | TextResult; done: string; found?: boolean }> => {
    const treeIfAsked = (screen: Screen): ActResult =>
      opts.read === 'tree' ? { tree: screen.tree } : {};
    await onTheScreen(s, [st as Partial<Point>, ...('to' in st ? [st.to] : [])]);
    switch (st.action) {
      case 'tap': {
        const t = await target(s, st, patient);
        const screen = s.device.hello?.screen;
        if (screen) noteTouch(t.point.x / screen.w, t.point.y / screen.h);
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
              pointers: [
                dragPath(from.point, to.point, st.durationMs ?? 500, st.holdMs ?? DRAG_HOLD_MS),
              ],
            },
            opts,
          ),
          done: `dragged ${from.name} to ${to.name}`,
        };
      }
      case 'swipe': {
        const start = st.ref || st.selector ? (await target(s, st, patient)).point : undefined;
        if (st.exact) {
          if (st.distance === undefined)
            throw new ToolError('exact needs distance', 'INVALID_ARGUMENT');
          return scrollBy(s, { ...st, ...start, distance: st.distance });
        }
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
            undefined,
            true,
          );
        // never the text itself (it may be a phone number or a code)
        return {
          r,
          done: `typed (${Array.from(st.text).length} characters${st.submit ? ', submitted' : ''}${r.verified === false ? ', the field read back holds other text' : r.verified === undefined ? ', not read back' : ''})`,
        };
      }
      case 'press_key': {
        const view = viewNamed(st.key);
        if (view) {
          if (!policy.allowHome)
            throw new ToolError(
              `${st.key} is off on this server: the app may not be left`,
              'POLICY_DENIED',
            );
          await s.device.openView(view);
          const { screen } = await settleRead(s);
          // what the answer compares with is what was on the screen before, not this read
          s.acted();
          return { r: treeIfAsked(screen), done: `opened ${view}` };
        }
        const { key, modifiers } = keyPress(st.key)!;
        const leaves = LEAVES_APP.has(key) || (modifiers.length > 0 && SHORTCUT_LEAVES.has(key));
        if (leaves && !policy.allowHome)
          throw new ToolError(
            `${st.key} is off on this server: the app may not be left`,
            'POLICY_DENIED',
          );
        const dark = NOTHING_TO_READ.has(key);
        const quiet = { settle: false, read: 'none' } as const;
        const count = st.count ?? 1;
        for (let i = 1; i < count; i++) await s.device.key(key, quiet, modifiers);
        return {
          r: await s.device.key(key, dark ? quiet : opts, modifiers),
          done: `pressed ${st.key}${count > 1 ? ` ${count} times` : ''}${dark ? ' (the screen was not read)' : ''}`,
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
    let found = false;
    return act(
      s,
      read,
      async (o) => {
        const x = await step(s, st, o);
        done = x.done;
        found = x.found === true;
        return x.r;
      },
      () => done,
      () => found,
    );
  };

  return { target, windowSize, onTheScreen, step, one, checkNow, waitFor, holdsStill, line };
}

export type Steps = ReturnType<typeof stepsFor>;
