import {
  type Selector as SelectorOf,
  type Screen,
  comparedWith,
  must,
  throwIfCancelled,
  withShownWords,
  type ActOptions,
} from '@appdyno/core';
import { DeviceError, type ActResult, type Point, type TextResult } from '@appdyno/protocol';
import type { Answers, ReadMode } from './answers.js';
import { noteTouch } from './activity.js';
import type { ServerContext } from './context.js';
import type { Session } from './session.js';
import { STALE_HINT, ToolError } from './tool.js';
import { backFromAlert } from './noticed.js';
import { byPerson, type Policy } from './policy.js';
import { LEAVES_APP, NEEDS_NO_LOOK, NOTHING_TO_READ, readBack, SHORTCUT_LEAVES } from './keys.js';
import {
  LONG_PRESS_MS,
  LOOKS_ONLY,
  Step,
  keyPress,
  showSelector,
  viewNamed,
} from './step-schemas.js';
import { scrollingFor } from './scroll.js';
import { typingAsIs } from './settings.js';
import { checksFor, selectorOf } from './checks.js';
import { pastKeyboard } from './keyboard.js';
import { aim, missed, NO_MATCH_HINT, pick, wordsOf, type Aim, type Aimed } from './targets.js';
import { wentAgain } from './between.js';
import { dragPath, swipeLine } from './gesture-paths.js';

export { NO_MATCH_WAIT_MS } from './targets.js';

const DRAG_HOLD_MS = 150;

/** What every step passes through on its way to the device (the recorder), which may add a line to what it says it did. */
export type StepSeam = <T extends { done: string }>(
  s: Session,
  st: Step,
  run: () => Promise<T>,
) => Promise<T>;

async function windowSize(s: Session) {
  const w =
    (await s.current()).window ??
    (s.device.hello && { w: s.device.hello.screen.w, h: s.device.hello.screen.h });
  if (!w)
    throw new ToolError('the screen size is unknown: give x, y and distance', 'INVALID_ARGUMENT');
  return w;
}

/**
 * A point past the screen's edge reaches nothing, and the answer would still say it was made. Measured by
 * the larger of what the tree shows and what the device said when opened: a phone turned since, or two apps
 * side by side, make either one too small alone, and a point on the screen is never refused.
 */
async function onTheScreen(s: Session, points: Partial<Point>[]) {
  const named = points.filter((p) => p.x !== undefined || p.y !== undefined);
  if (named.length === 0) return;
  const known = [(await s.current()).window, s.device.hello?.screen].filter((z) => z !== undefined);
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
}

/**
 * What a step did: the device's answer, said in words, and whether a scroll to an element found what it looked for; `back`: what
 * the screen after a touch that closed a system alert waits for (`backFromAlert`); `at`: where a tap went.
 */
type Done = {
  r: ActResult | TextResult;
  done: string;
  found?: boolean;
  back?: ((x: Screen) => boolean) | undefined;
  at?: Point;
  /** What a wait found its element on. */
  screen?: Screen;
};

/** A touch's options, compared with the read a selector found each of its targets on. */
const aimedOn = (opts: ActOptions, ...targets: (Aimed | undefined)[]): ActOptions =>
  comparedWith(opts, ...targets.map((t) => t?.on));

/** A touch at `at` on the screen just read: on a system alert, what its answer waits for. */
const closes = (s: Session, at: Point) => (s.fresh ? backFromAlert(s, s.fresh, at) : undefined);

/** What one step's call takes from the steps around it. */
type Kit = {
  policy: Policy;
  settleRead: Answers['settleRead'];
  target: (s: Session, a: Aim, patient?: boolean, typing?: boolean) => ReturnType<typeof aim>;
  scrolling: ReturnType<typeof scrollingFor>;
  checks: ReturnType<typeof checksFor>;
  missing: (
    s: Session,
    screen: Screen,
    a: { gone: boolean; selector?: SelectorOf | undefined; seen?: boolean },
  ) => { over: string; said: string; hint: string };
};

/** A screen a step only looked at, as the device's answer when the action asked for its tree. */
const treeIfAsked = (opts: ActOptions, screen: Screen): ActResult =>
  opts.read === 'tree' ? { tree: screen.tree } : {};

async function typeText(
  s: Session,
  st: Extract<Step, { action: 'type_text' }>,
  at: Point | undefined,
  opts: ActOptions,
): Promise<Done> {
  // a simulator types a US keyboard's text by its helper's keys, anything else by its runner, which it may wait
  // for: a typing by keys that the runner's start ended meanwhile is no wait, and takes no 3 s
  // a simulator's keyboard would rewrite the text once its field loses the focus
  const asIs = await typingAsIs(s);
  const waited = s.device.agentUp ? undefined : Date.now();
  const r = await s.device
    .typeText(st.text, {
      ...(at && { at }),
      replace: st.replace ?? false,
      submit: st.submit ?? false,
      ...opts,
    })
    .catch((e: unknown) => {
      // text that may have gone may have gone in part, as keys typed one by one: typed again, it would follow it
      if (e instanceof DeviceError && e.sent)
        e.message += '; part of the text may be in the field: read it, and type with replace: true';
      throw e;
    });
  const started =
    waited !== undefined && s.device.agentUp && Date.now() - waited >= 3_000
      ? `, after the runner's start: ${((Date.now() - waited) / 1000).toFixed(1)} s`
      : '';
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
    done: `typed (${Array.from(st.text).length} characters${st.submit && r.submitted !== false ? ', submitted' : ''}${r.verified === false ? ', the field read back holds other text' : r.verified === undefined ? ', not read back' : ''}${r.submitted === false ? ', so it was not submitted' : ''}${started})${asIs ? `; ${asIs}` : ''}`,
  };
}

async function pressKey(
  { policy, settleRead }: Kit,
  s: Session,
  st: Extract<Step, { action: 'press_key' }>,
  opts: ActOptions,
): Promise<Done> {
  const view = viewNamed(st.key);
  if (view) {
    if (!policy.allowHome)
      throw new ToolError(
        `${st.key} is off on this server: the app may not be left`,
        'POLICY_DENIED',
        byPerson('by starting it without --no-home'),
      );
    s.leftTheApp();
    await s.device.openView(view);
    const { screen } = await settleRead(s);
    // what the answer compares with is what was on the screen before, not this read
    s.acted();
    return { r: treeIfAsked(opts, screen), done: `opened ${view}` };
  }
  const { key, modifiers } = must(keyPress(st.key), `the key ${st.key}`);
  const leaves = LEAVES_APP.has(key) || (modifiers.length > 0 && SHORTCUT_LEAVES.has(key));
  if (leaves && !policy.allowHome)
    throw new ToolError(
      `${st.key} is off on this server: the app may not be left`,
      'POLICY_DENIED',
      byPerson('by starting it without --no-home'),
    );
  // a back that leaves the app is the person's leaving too; one that stays is undone by the app in front again
  if (leaves || key === 'back') s.leftTheApp();
  const dark = NOTHING_TO_READ.has(key);
  const quiet = { settle: false, read: 'none' } as const;
  const count = st.count ?? 1;
  const pressed: ActResult[] = [];
  for (let i = 1; i < count; i++) {
    pressed.push(await s.device.key(key, quiet, modifiers));
    // a call refused meanwhile, as its app died, presses no more
    throwIfCancelled('press_key');
  }
  const r = await s.device.key(key, dark ? quiet : opts, modifiers);
  return {
    r,
    done: `pressed ${st.key}${count > 1 ? ` ${count} times` : ''}${dark ? ' (the screen was not read)' : ''}${readBack(st.key, key, [...pressed, r])}`,
  };
}

/** Where the platform types blind: with no field holding the focus and no keyboard up, no key is sent. */
async function focusFirst(s: Session) {
  const port = s.device.platformScreen;
  if (!port.typesBlind) return;
  const takes = (x: Screen) =>
    x.elements.some((e) => e.focused && e.editable) || port.keyboardOpen(x.tree);
  // a field the app focused by itself since the last read counts: that read is taken again before a refusal
  if (!takes(await s.justNow()) && !takes(await s.read()))
    throw new DeviceError('NO_FOCUS', 'no editable field has the focus');
}

/** What a step does on the device, by its kind. */
async function call(
  kit: Kit,
  s: Session,
  st: Step,
  opts: ActOptions,
  patient: boolean,
): Promise<Done> {
  const { target, scrolling, checks } = kit;
  await onTheScreen(s, [st as Partial<Point>, ...('to' in st ? [st.to] : [])]);
  switch (st.action) {
    case 'tap': {
      const t = await target(s, st, patient);
      const screen = s.device.hello?.screen;
      if (screen) noteTouch(t.point.x / screen.w, t.point.y / screen.h);
      const back = await closes(s, t.point);
      return {
        r: await s.device.tap(t.point, aimedOn(opts, t)),
        done: `tapped ${t.name}`,
        back,
        at: t.point,
      };
    }
    case 'long_press': {
      const t = await target(s, st, patient);
      const back = await closes(s, t.point);
      return {
        r: await s.device.longPress(t.point, st.durationMs ?? LONG_PRESS_MS, aimedOn(opts, t)),
        done: `long-pressed ${t.name}`,
        back,
      };
    }
    case 'double_tap': {
      const t = await target(s, st, patient);
      const back = await closes(s, t.point);
      return {
        r: await s.device.act({ kind: 'doubleTap', ...t.point }, aimedOn(opts, t)),
        done: `double-tapped ${t.name}`,
        back,
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
          aimedOn(opts, from, to),
        ),
        done: `dragged ${from.name} to ${to.name}`,
      };
    }
    case 'swipe': {
      const t = st.ref || st.selector ? await target(s, st, patient) : undefined;
      if (st.exact) {
        if (st.distance === undefined)
          throw new ToolError('exact needs distance', 'INVALID_ARGUMENT');
        return scrolling.scrollBy(s, { ...st, ...t?.point, distance: st.distance });
      }
      const { from, to } = swipeLine(await windowSize(s), { ...st, ...t?.point });
      return {
        r: await s.device.swipe(from, to, st.durationMs ?? 300, aimedOn(opts, t)),
        done: `swiped (${st.direction})`,
      };
    }
    case 'type_text': {
      const t =
        st.ref || st.selector || st.x !== undefined
          ? await target(s, st, patient, true)
          : undefined;
      if (!t) await focusFirst(s);
      return typeText(s, st, t?.point, aimedOn(opts, t));
    }
    case 'press_key':
      return pressKey(kit, s, st, opts);
    case 'wait_for': {
      const w = await checks.waitFor(s, st);
      const what = st.ref ?? showSelector(selectorOf(st.selector) ?? {});
      if (!w.met) {
        const why = kit.missing(s, w.screen, { ...st, seen: !!w.seen });
        throw new ToolError(
          `${why.over}${what} ${st.gone ? 'still there' : 'not shown'} after ${st.timeoutMs} ms${why.said}`,
          'CHECK_FAILED',
          why.hint,
        );
      }
      return {
        r: treeIfAsked(opts, w.screen),
        done: `${what} ${st.gone ? 'gone' : 'shown'}`,
        screen: w.screen,
      };
    }
    case 'assert': {
      const c = await checks.checkNow(s, st);
      return { r: treeIfAsked(opts, c.screen), done: c.done };
    }
    case 'scroll_to':
      return scrolling.scrollTo(s, st);
  }
}

/** What a refusal says to do in place of a read of the screen, where it holds the screen itself. */
const WITH_SCREEN: Record<string, string> = {
  [STALE_HINT]: 'the screen now is above: act on what it shows',
  [NO_MATCH_HINT]:
    'the screen now is above; use swipe_screen with until if it may be further along a list',
};

/** A refusal's hint where the refusal holds the screen itself: it sends nobody to read it. */
export const hintWithScreen = (hint: string | undefined) =>
  hint && (WITH_SCREEN[hint] ?? hint.replace(', or read the screen', ''));

/** One step's device call and the action around it, shared by the tools that act on a target. */
export function stepsFor(
  ctx: ServerContext,
  { act, clean, settleRead, left }: Answers,
  through: StepSeam,
) {
  const words = wordsOf(clean);
  const { line, offer } = words;
  const target = async (s: Session, a: Aim, patient = false, typing = false) => {
    const t = await pastKeyboard(s, a, () => aim(s, a, words, typing), patient);
    // a ref is named by its words at the touch: where those are not the ones it was shown with, which the answer's diff
    // is against, both are said, as an old screen's ref read as if the touch had renamed it
    const was = a.ref ? s.refWords.get(a.ref) : undefined;
    return a.ref && was !== undefined
      ? { ...t, name: withShownWords(t.name, a.ref, clean(was)) }
      : t;
  };
  const scrolling = scrollingFor({
    windowSize,
    line,
    pick: (hits, sel, sent) => pick(hits, sel, line, sent),
    offer,
  });
  const checks = checksFor({ ctx, clean, line, offer });
  /** What a wait that ran out says: the nearest of what it waited to show, and what to do next. */
  const missing: Kit['missing'] = (s, screen, a) => {
    const why = a.gone
      ? { over: '', said: '' }
      : missed(s, screen, a.selector?.text ?? a.selector?.id, words);
    return {
      over: why.over,
      said: `${a.seen ? wentAgain(screen, clean) : ''}${why.said}`,
      hint: why.hint ?? 'call again to wait longer, or read the screen',
    };
  };
  const kit: Kit = { policy: ctx.policy, settleRead, target, scrolling, checks, missing };

  /** One step's device call. `patient`: in a sequence, a ref may need a moment to come. */
  const step = (s: Session, st: Step, opts: ActOptions, patient = false) =>
    through(s, st, async () => {
      if (!LOOKS_ONLY.has(st.action) && !(st.action === 'press_key' && NEEDS_NO_LOOK.has(st.key)))
        await s.beforeTouch();
      // a selector names what is there at the touch: one the device refused before it went, as another window came in
      // front since the read it was found on, is looked for again on the screen in front, once
      return call(kit, s, st, opts, patient).catch((e: unknown) => {
        const inFront = e instanceof DeviceError && e.code === 'STALE' && !e.sent;
        if (!inFront || !('selector' in st && st.selector) || ('ref' in st && st.ref)) throw e;
        return call(kit, s, st, opts, patient);
      });
    });

  /**
   * A refusal for an element that is not there, with the screen that is: a stale ref or a selector with no match would
   * else cost a read of the screen and a turn before the next try.
   */
  const withScreen = async (s: Session, e: unknown, read: ReadMode) => {
    if (!(e instanceof ToolError) || read === 'none') return e;
    if (e.code !== 'STALE' && e.code !== 'NOT_FOUND') return e;
    // a fresh read: what the device refused the touch for may be what the last read does not show
    const screen = await s.read().catch(() => undefined);
    if (!screen) return e;
    return new ToolError(
      `${e.message}\n${left(s, screen, read)}`,
      e.code,
      hintWithScreen(e.hint),
      e.dispatched,
    );
  };

  const one = async (s: Session, st: Step, read: ReadMode) => {
    let done = '';
    let found = false;
    let back: Done['back'];
    let at: Done['at'];
    return act(
      s,
      read,
      async (o) => {
        const x = await step(s, st, o);
        done = x.done;
        found = x.found === true;
        back = x.back;
        at = x.at;
        return x.r;
      },
      () => done,
      () => found,
      (x) => back?.(x) ?? true,
      () => at,
    ).catch(async (e: unknown) => {
      throw await withScreen(s, e, read);
    });
  };

  const { checkNow, waitFor } = checks;
  const { holdsStill } = scrolling;
  return {
    target,
    windowSize,
    onTheScreen,
    step,
    one,
    checkNow,
    waitFor,
    holdsStill,
    line,
    missing,
  };
}

export type Steps = ReturnType<typeof stepsFor>;
