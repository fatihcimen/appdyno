import {
  type Selector as SelectorOf,
  type ScreenElement,
  nearest,
  selectIn,
  type Screen,
  must,
  throwIfCancelled,
  type ActOptions,
} from '@appdyno/core';
import { DeviceError, type ActResult, type Point, type TextResult } from '@appdyno/protocol';
import type { Answers, ReadMode } from './answers.js';
import { noteTouch } from './activity.js';
import type { ServerContext } from './context.js';
import type { Session } from './session.js';
import { ToolError } from './tool.js';
import { byPerson, type Policy } from './policy.js';
import { LEAVES_APP, NEEDS_NO_LOOK, NOTHING_TO_READ, SHORTCUT_LEAVES } from './keys.js';
import {
  LOOKS_ONLY,
  NAME_AN_ELEMENT,
  Step,
  keyPress,
  showSelector,
  viewNamed,
} from './step-schemas.js';
import { scrollingFor } from './scroll.js';
import { checksFor, selectorOf, UNREAD } from './checks.js';
import { pastKeyboard } from './keyboard.js';
import { dragPath, swipeLine } from './gesture-paths.js';

const STALE = 'stale ref, read the screen again';

/** How long a selector with no match waits for its element, as a screen may still be coming. */
export const NO_MATCH_WAIT_MS = 1_500;

const DRAG_HOLD_MS = 150;

/** What every step passes through on its way to the device (the recorder). */
export type StepSeam = <T>(s: Session, st: Step, run: () => Promise<T>) => Promise<T>;

/** How a step names elements: by its words made safe, one to a line, and the nearest to what it wanted. */
type Words = {
  clean: (s: string) => string;
  line: (e: ScreenElement) => string;
  offer: (list: ScreenElement[], want?: string) => string;
};

function wordsOf(clean: (s: string) => string): Words {
  const line = (e: ScreenElement) =>
    `${e.ref} ${e.role} ${JSON.stringify(clean(e.label || e.id || ''))} ${e.x},${e.y}`;
  const offer = (list: ScreenElement[], want?: string) => {
    const near = nearest(list, want).map(line);
    return near.length > 0 ? `; nearest: ${near.join('; ')}` : '';
  };
  return { clean, line, offer };
}

/** One element of a selector's matches, or a refusal listing them. */
function pick(hits: ScreenElement[], sel: SelectorOf, line: Words['line']): ScreenElement {
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
}

/** A selector on a fresh read; no match waits a moment, as the screen may still be coming. */
async function resolve(
  s: Session,
  sel: SelectorOf,
  { line, offer }: Words,
): Promise<ScreenElement> {
  const { screen, met } = await s.until((x) => selectIn(x.list, sel).length > 0, NO_MATCH_WAIT_MS);
  if (!screen) throw new ToolError('the screen could not be read', 'NOT_FOUND', UNREAD);
  if (!met)
    throw new ToolError(
      `no element matches ${showSelector(sel)} after ${NO_MATCH_WAIT_MS} ms${offer(screen.list, sel.text ?? sel.id)}`,
      'NOT_FOUND',
      'read the screen, or use scroll_to if it may be further along a list',
    );
  return pick(selectIn(screen.list, sel), sel, line);
}

type Aim = { ref?: string; x?: number; y?: number; selector?: SelectorOf };

/** The point of a ref (on the device's current screen), a selector or x,y. */
async function aim(s: Session, a: Aim, patient: boolean, words: Words) {
  const { clean } = words;
  if (a.ref) {
    const has = (x: Screen | undefined) => x?.list.find((e) => e.ref === a.ref);
    const e =
      has(await s.justNow()) ??
      (patient ? has((await s.until((x) => !!has(x), NO_MATCH_WAIT_MS)).screen) : undefined);
    if (!e) throw new ToolError(`${STALE}: ${a.ref} is not on this screen`, 'STALE');
    return { point: { x: e.x, y: e.y }, name: `${a.ref} ${JSON.stringify(clean(e.label))}` };
  }
  if (a.selector) {
    const e = await resolve(s, a.selector, words);
    return { point: { x: e.x, y: e.y }, name: `${e.ref} ${JSON.stringify(clean(e.label))}` };
  }
  if (a.x === undefined || a.y === undefined)
    throw new ToolError('give a ref, a selector, or x and y', 'INVALID_ARGUMENT', NAME_AN_ELEMENT);
  return { point: { x: a.x, y: a.y }, name: `${a.x},${a.y}` };
}

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

/** What a step did: the device's answer, said in words, and whether `scroll_to` found what it looked for. */
type Done = { r: ActResult | TextResult; done: string; found?: boolean };

/** What one step's call takes from the steps around it. */
type Kit = {
  policy: Policy;
  settleRead: Answers['settleRead'];
  target: (s: Session, a: Aim, patient?: boolean) => ReturnType<typeof aim>;
  scrolling: ReturnType<typeof scrollingFor>;
  checks: ReturnType<typeof checksFor>;
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
    done: `typed (${Array.from(st.text).length} characters${st.submit && r.submitted !== false ? ', submitted' : ''}${r.verified === false ? ', the field read back holds other text' : r.verified === undefined ? ', not read back' : ''}${r.submitted === false ? ', so it was not submitted' : ''}${started})`,
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
  if (leaves) s.leftTheApp();
  const dark = NOTHING_TO_READ.has(key);
  const quiet = { settle: false, read: 'none' } as const;
  const count = st.count ?? 1;
  for (let i = 1; i < count; i++) {
    await s.device.key(key, quiet, modifiers);
    // a call refused meanwhile, as its app died, presses no more
    throwIfCancelled('press_key');
  }
  return {
    r: await s.device.key(key, dark ? quiet : opts, modifiers),
    done: `pressed ${st.key}${count > 1 ? ` ${count} times` : ''}${dark ? ' (the screen was not read)' : ''}`,
  };
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
        return scrolling.scrollBy(s, { ...st, ...start, distance: st.distance });
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
      return typeText(s, st, at, opts);
    }
    case 'press_key':
      return pressKey(kit, s, st, opts);
    case 'wait_for': {
      const w = await checks.waitFor(s, st);
      const what = st.ref ?? showSelector(selectorOf(st) ?? {});
      if (!w.met)
        throw new ToolError(
          `${what} ${st.gone ? 'still there' : 'not shown'} after ${st.timeoutMs} ms`,
          'TIMEOUT',
        );
      return { r: treeIfAsked(opts, w.screen), done: `${what} ${st.gone ? 'gone' : 'shown'}` };
    }
    case 'assert': {
      const c = await checks.checkNow(s, st);
      return { r: treeIfAsked(opts, c.screen), done: c.done };
    }
    case 'scroll_to':
      return scrolling.scrollTo(s, st);
  }
}

/** One step's device call and the action around it, shared by the tools that act on a target. */
export function stepsFor(
  ctx: ServerContext,
  { act, clean, settleRead }: Answers,
  through: StepSeam,
) {
  const words = wordsOf(clean);
  const { line, offer } = words;
  const target = (s: Session, a: Aim, patient = false) =>
    pastKeyboard(s, a, (p) => aim(s, a, p, words), patient);
  const scrolling = scrollingFor({
    windowSize,
    line,
    pick: (hits, sel) => pick(hits, sel, line),
    offer,
  });
  const checks = checksFor({ ctx, clean, line, offer });
  const kit: Kit = { policy: ctx.policy, settleRead, target, scrolling, checks };

  /** One step's device call. `patient`: in a sequence, a ref may need a moment to come. */
  const step = (s: Session, st: Step, opts: ActOptions, patient = false) =>
    through(s, st, async () => {
      if (!LOOKS_ONLY.has(st.action) && !(st.action === 'press_key' && NEEDS_NO_LOOK.has(st.key)))
        await s.beforeTouch();
      return call(kit, s, st, opts, patient);
    });

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

  const { checkNow, waitFor } = checks;
  const { holdsStill } = scrolling;
  return { target, windowSize, onTheScreen, step, one, checkNow, waitFor, holdsStill, line };
}

export type Steps = ReturnType<typeof stepsFor>;
