import {
  attributesOf,
  frontChanged,
  frontOf,
  must,
  selectIn,
  type Screen,
  type ScreenElement,
  type Selector as SelectorOf,
} from '@appdyno/core';
import { SETTLE_DEFAULT } from '@appdyno/protocol';
import type { z } from 'zod';
import { overApp } from './between.js';
import type { ServerContext } from './context.js';
import type { Session } from './session.js';
import { type Check, NAME_AN_ELEMENT, showSelector } from './step-schemas.js';
import { ToolError } from './tool.js';
import { motionText, movedIn, watchScreen } from './watch.js';

/** A wait that read nothing: read_screen says why the device refuses it. */
export const UNREAD = 'read_screen reads it once more and says what the device answered';

/** How long a check watches with no time of its own. */
const WATCH_CHECK_MS = 2_000;

/**
 * Whether what a wait found on `first` holds through the settle's quiet window: still there on the screen after it, with
 * the same app and system windows in front and no window sliding. A screen whose content still moves, as a banner, holds.
 */
async function held(s: Session, first: Screen, there: (x: Screen) => boolean, end: number) {
  const now = await s.after(first, Math.min(SETTLE_DEFAULT.quietMs, Math.max(0, end - Date.now())));
  if (!now) return { held: false, screen: first };
  const same = !frontChanged(frontOf(first.tree), frontOf(now.tree));
  return { held: there(now) && same && !now.tree.moving, screen: now };
}

/** A selector that names something: its words, with no key set to nothing. */
export const selectorOf = (a: SelectorOf | undefined): SelectorOf | undefined =>
  a && (a.text || a.id || a.role)
    ? {
        ...(a.text && { text: a.text }),
        ...(a.id && { id: a.id }),
        ...(a.role && { role: a.role }),
        ...(a.index !== undefined && { index: a.index }),
      }
    : undefined;

type Judged = {
  ref?: string;
  selector?: SelectorOf;
  check: z.infer<typeof Check>;
  equals?: string;
  expect: boolean;
};

/** What only looks at the screen: a check of an element, and a wait for one to show or go. */
export function checksFor({
  ctx,
  clean,
  line,
  offer,
}: {
  ctx: ServerContext;
  clean: (s: string) => string;
  line: (e: ScreenElement) => string;
  offer: (list: ScreenElement[], want?: string) => string;
}) {
  /** Whether a check holds on this screen, and why or why not in words. */
  const judge = (screen: Screen, a: Judged): { pass: boolean; why: string; none?: boolean } => {
    const sel = selectorOf(a.selector) ?? {};
    const what = a.ref ?? showSelector(sel);
    const all = a.ref ? screen.list.filter((e) => e.ref === a.ref) : selectIn(screen.list, sel);
    const hits = sel.index === undefined ? all : all.slice(sel.index, sel.index + 1);
    const missing = `${what} is not on the screen${offer(screen.list, sel.text ?? sel.id)}`;
    if (a.check === 'exists' || a.check === 'absent') {
      const want = a.check === 'absent' ? !a.expect : a.expect;
      if (hits.length > 0 === want)
        return { pass: true, why: `${what} is ${want ? 'on' : 'not on'} the screen` };
      return want
        ? { pass: false, why: missing, none: true }
        : {
            pass: false,
            why: `${what} is on the screen: ${hits.slice(0, 5).map(line).join('; ')}`,
          };
    }
    if (hits.length === 0) return { pass: false, why: missing, none: true };
    if (hits.length > 1)
      return {
        pass: false,
        why: `${hits.length} elements match ${what}: ${hits.slice(0, 5).map(line).join('; ')}`,
      };
    const at = attributesOf(screen.elements, must(hits[0], 'the one match'));
    if (a.check === 'text') {
      if (a.equals === undefined)
        throw new ToolError('check text needs equals', 'INVALID_ARGUMENT');
      const reads = at.text === a.equals || at.value === a.equals;
      const want = JSON.stringify(clean(a.equals));
      const why = reads
        ? `${what} reads ${want}`
        : `${what} reads ${JSON.stringify(clean(at.value ?? at.text))}, not ${want}`;
      return {
        pass: reads === a.expect,
        why: reads && !a.expect ? `${why}, which it must not` : why,
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
    const sel = selectorOf(a.selector);
    const element = a.ref
      ? screen.list.find((e) => e.ref === a.ref)
      : sel && selectIn(screen.list, sel)[sel.index ?? 0];
    if ((a.ref || sel) && !element)
      throw new ToolError('nothing to watch by those words', 'CHECK_FAILED');
    const box = element && {
      x: element.rect.x,
      y: element.rect.y,
      w: element.rect.width,
      h: element.rect.height,
    };
    const { screen: size } = must(s.device.hello, "the agent's hello");
    const moved = movedIn(m, size, box, !a.expect);
    const said = motionText(m, size);
    if (moved !== a.expect) throw new ToolError(said, 'CHECK_FAILED');
    return { screen, done: `check passed: ${said}` };
  };

  /**
   * "Not on the screen", said of a screen whose words come from its picture where that read failed: not known, and
   * no pass.
   */
  const unread = (s: Session, what: string) => {
    if (s.pictureFailed)
      throw new ToolError(
        `cannot tell that ${what} is not on the screen: its tree has no words, and its picture could not be read: ${s.pictureFailed}`,
        'CHECK_FAILED',
      );
  };

  /** A check on a fresh read, given `timeoutMs` to come true; a refusal when it does not. */
  const checkNow = async (s: Session, a: Judged & { timeoutMs: number }) => {
    if (a.check === 'moves') return movesNow(s, a);
    if (!a.ref && !selectorOf(a.selector))
      throw new ToolError(
        'give a ref, or a selector with text, id or role',
        'INVALID_ARGUMENT',
        NAME_AN_ELEMENT,
      );
    const { screen } = await s.until((x) => judge(x, a).pass, a.timeoutMs);
    if (!screen) throw new ToolError('the screen could not be read', 'NOT_FOUND', UNREAD);
    const v = judge(screen, a);
    if (!v.pass)
      throw new ToolError(`${v.none ? overApp(s, screen, clean) : ''}${v.why}`, 'CHECK_FAILED');
    if ((a.check === 'absent') === a.expect && (a.check === 'absent' || a.check === 'exists'))
      unread(s, a.ref ?? showSelector(selectorOf(a.selector) ?? {}));
    return { screen, done: `check passed: ${v.why}` };
  };

  /**
   * Waits for an element to show or go, on the device where its agent can. One shown counts once it holds through the
   * settle's quiet window, as a frame of a screen on its way in or out does not; `seen`: one that was shown and went
   * before it held. `hold: false`: what a touch looks for, which holds still before it by itself.
   */
  const waitFor = async (
    s: Session,
    a: { ref?: string; selector?: SelectorOf; gone: boolean; timeoutMs: number },
    hold = true,
  ) => {
    const sel = selectorOf(a.selector);
    if (!a.ref && !sel)
      throw new ToolError(
        'give a ref, or a selector with text, id or role',
        'INVALID_ARGUMENT',
        NAME_AN_ELEMENT,
      );
    const found = (x: Screen) =>
      (a.ref ? x.list.filter((e) => e.ref === a.ref) : selectIn(x.list, must(sel, 'a selector')))[
        sel?.index ?? 0
      ];
    const end = Date.now() + a.timeoutMs;
    let seen: Screen | undefined;
    for (;;) {
      const { screen, met } = await s.until(
        (x) => !!found(x) !== a.gone,
        Math.max(0, end - Date.now()),
      );
      if (!screen)
        throw new ToolError('the screen could not be read: nothing to look in', 'NOT_FOUND');
      if (a.gone && met) unread(s, a.ref ?? showSelector(must(sel, 'a selector')));
      if (!met || a.gone || !hold) return { screen, met, found: found(screen), seen };
      const now = await held(s, screen, (x) => !!found(x), end);
      // at the end of the time one still there counts: a window that never rests is no reason to fail
      if (now.held || Date.now() >= end) {
        const there = found(now.screen);
        return { screen: now.screen, met: !!there, found: there, seen: there ? undefined : screen };
      }
      seen = screen;
    }
  };

  return { checkNow, waitFor };
}
