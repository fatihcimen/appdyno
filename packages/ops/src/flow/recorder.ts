import { byRef, must, type Screen, type ScreenElement, selectIn } from '@appdyno/core';
import { type FlowSelector, type FlowStep, type Flag, Recording } from '@appdyno/flows';
import type { ServerContext } from '../context.js';
import type { Session } from '../session.js';
import { LONG_PRESS_MS, SCROLL_MAX, type Step, WAIT_MS } from '../step-schemas.js';
import { NO_MATCH_WAIT_MS } from '../steps.js';
import { onlyReads, type Op, type ToolResult } from '../tool.js';
import { BY_STEP, NOT_ACTIONS } from '../tool-kinds.js';
import { type Aim, aimAt, fieldName, named, notReplayed, stepOf, unrecorded } from './aim.js';
import { dragRecord, type Target } from './recorder-gaps.js';
import { toolStep } from './tool-steps.js';
import { activeRecording, addSteps, defined } from './shared.js';

/** Ops that only look and are steps all the same: a check, a picture kept, a comparison. */
const LOOKING_STEPS: ReadonlySet<string> = new Set([
  'check_element',
  'take_screenshot',
  'check_screen',
]);

type Selector = {
  text?: string | undefined;
  id?: string | undefined;
  role?: string | undefined;
  index?: number | undefined;
};

const selectorOf = (a: Selector | undefined): FlowSelector | undefined =>
  a && (a.text || a.id || a.role)
    ? defined({ id: a.id, role: a.role, text: a.text, index: a.index })
    : undefined;

const size = async (s: Session) =>
  (await s.current()).window ??
  (s.device.hello && { w: s.device.hello.screen.w, h: s.device.hello.screen.h });

/** A target on the screen the action is about to act on: a selector when anything names it, else flagged coordinates. */
async function aim(s: Session, t: Target): Promise<Aim> {
  let screen: Screen | undefined;
  let e: ScreenElement | undefined;
  if (t.ref) {
    const ref = t.ref;
    const has = (x: Screen) => byRef(x, ref);
    screen = await s.current();
    if (!has(screen)) screen = (await s.until((x) => !!has(x), NO_MATCH_WAIT_MS)).screen;
    e = screen && has(screen);
    // one only `screen raw` gives is named by what a touch at its middle reaches, as a point is
    if (screen && e && !screen.list.includes(e))
      return aimAt(screen, { x: e.x, y: e.y }, await size(s));
  } else if (t.selector) {
    const sel = t.selector;
    screen = (await s.until((x) => selectIn(x.list, sel).length > 0, NO_MATCH_WAIT_MS)).screen;
    e = screen && selectIn(screen.list, sel)[sel.index ?? 0];
  } else if (t.x !== undefined && t.y !== undefined) {
    return aimAt(await s.current(), { x: t.x, y: t.y }, await size(s));
  } else return { screen: await s.current() };
  if (!screen || !e) return { screen };
  return { screen, element: e, ...named(screen, e) };
}

const hasTarget = (st: Target) => !!(st.ref || st.selector || st.x !== undefined);

type StepOf<A extends Step['action']> = Extract<Step, { action: A }>;

async function pressRecord(s: Session, st: StepOf<'tap' | 'double_tap' | 'long_press'>) {
  const a = await aim(s, st);
  // a hold of the usual length is the step's own, and unsaid
  const held = st.action === 'long_press' ? st.durationMs : undefined;
  const durationMs = held === LONG_PRESS_MS ? undefined : held;
  return () =>
    a.selector || a.args
      ? stepOf(st.action, a, { durationMs })
      : unrecorded(`${st.action} of an element gone from the screen`);
}

async function swipeRecord(s: Session, st: StepOf<'swipe'>) {
  const a = hasTarget(st) ? await aim(s, st) : {};
  // a distance is in this device's units, so it holds for this screen size only
  const w = st.distance !== undefined ? await size(s) : undefined;
  return () =>
    stepOf(
      'swipe',
      {
        ...a,
        ...(w && { flags: ['coordinates'] as Flag[] }),
      },
      {
        direction: st.direction,
        distance: st.distance,
        durationMs: st.durationMs,
        ...(w && { screen: `${w.w}x${w.h}` }),
      },
    );
}

async function typeRecord(r: Recording, s: Session, st: StepOf<'type_text'>) {
  const targeted = hasTarget(st);
  const a = await aim(s, st);
  const el = a.screen?.elements.find((x) => (targeted ? x.ref === a.element?.ref : x.focused));
  if (el?.password) r.learnSecret(st.text, fieldName(el));
  return () =>
    stepOf('type', targeted ? a : {}, {
      text: st.text,
      replace: st.replace || undefined,
      submit: st.submit || undefined,
    });
}

// shortcut: x, y (which of several lists) is not kept, as it holds for one screen size; replay
// scrolls the biggest list and stops if that was the wrong one
const scrollRecord = (st: StepOf<'scroll_to'>) => () =>
  stepOf(
    'scroll_to',
    {
      selector: st.selector,
      flags: st.selector.index !== undefined ? ['ambiguous'] : [],
    },
    {
      direction: st.direction === 'up' ? undefined : st.direction,
      maxSwipes: st.maxSwipes === SCROLL_MAX ? undefined : st.maxSwipes,
    },
  );

/** A check keeps the agent's words, which are what it checks; a ref is named for later. */
async function looked(
  s: Session,
  a: { ref?: string | undefined; selector?: Selector | undefined },
): Promise<Aim> {
  if (a.ref) return aim(s, { ref: a.ref });
  const selector = selectorOf(a.selector);
  return {
    ...(selector && { selector, flags: selector.index !== undefined ? ['ambiguous'] : [] }),
  };
}

async function waitRecord(
  s: Session,
  a: {
    ref?: string | undefined;
    selector?: Selector | undefined;
    gone: boolean;
    timeoutMs: number;
  },
) {
  const at = await looked(s, a);
  return () =>
    at.selector
      ? stepOf('wait_for', at, {
          gone: a.gone || undefined,
          timeoutMs: a.timeoutMs === WAIT_MS ? undefined : a.timeoutMs,
        })
      : undefined;
}

async function assertRecord(
  s: Session,
  a: {
    ref?: string | undefined;
    check: string;
    equals?: string | undefined;
    expect: boolean;
    timeoutMs: number;
    selector?: Selector | undefined;
  },
) {
  const at = await looked(s, a);
  return () =>
    at.selector
      ? stepOf('assert', at, {
          check: a.check === 'exists' ? undefined : a.check,
          equals: a.equals,
          expect: a.expect ? undefined : false,
          timeoutMs: a.timeoutMs || undefined,
        })
      : undefined;
}

/** A step's record, known before it runs as the screen is about to change. */
async function recordOf(r: Recording, s: Session, st: Step): Promise<() => FlowStep | undefined> {
  switch (st.action) {
    case 'tap':
    case 'double_tap':
    case 'long_press':
      return pressRecord(s, st);
    case 'drag':
      return dragRecord(aim, size, s, st);
    case 'swipe':
      return swipeRecord(s, st);
    case 'type_text':
      return typeRecord(r, s, st);
    case 'press_key':
      return () => stepOf('press_key', {}, { key: st.key, count: st.count });
    case 'wait_for':
      return waitRecord(s, st);
    case 'assert':
      return assertRecord(s, st);
    case 'scroll_to':
      return scrollRecord(st);
  }
}

/** An answer with one more line: under what it says it did, where its words begin with that, as a step's has it. */
function withLine(out: ToolResult, line: string | undefined): ToolResult {
  if (!line) return out;
  const at = out.blocks.findIndex((b) => b.type === 'text');
  if (at < 0) return { ...out, blocks: [{ type: 'text', text: line }, ...out.blocks] };
  const done = typeof out.data.done === 'string' ? out.data.done : '';
  const under = (text: string) =>
    done && text.startsWith(done)
      ? `${done}\n${line}${text.slice(done.length)}`
      : `${text}\n${line}`;
  const blocks = out.blocks.map((b, i) =>
    i === at && b.type === 'text' ? { ...b, text: under(b.text) } : b,
  );
  return { ...out, blocks };
}

/**
 * The one place the recorder touches the operations: every step an action runs passes `through`, every
 * other op passes `wrap`. Nothing is written unless the action succeeded, and an action that left no step
 * says so in its own answer.
 */
export function flowRecorder(ctx: ServerContext) {
  return {
    /** Around one step of `tap`, `steps` and the like. */
    through: async <T extends { done: string }>(
      s: Session,
      st: Step,
      run: () => Promise<T>,
    ): Promise<T> => {
      const r = activeRecording(ctx, s.device.serial);
      if (!r) return run();
      const record = await recordOf(r, s, st);
      const out = await run();
      const step = record();
      addSteps(r, step);
      const line = notReplayed(step);
      return line ? { ...out, done: `${out.done}\n${line}` } : out;
    },

    /** The op as the surfaces see it. */
    wrap: (op: Op): Op => {
      const elsewhere = BY_STEP.has(op.name) || NOT_ACTIONS.has(op.name);
      if (!LOOKING_STEPS.has(op.name) && (elsewhere || onlyReads(op))) return op;
      const toStep = toolStep(op.name);
      return {
        ...op,
        handler: async (args): Promise<ToolResult> => {
          // no device: the op itself says what is wrong; Metro needs none, so none is opened for it
          const s =
            op.name === 'inspect_app' && String(args.action).startsWith('rn_')
              ? undefined
              : await (
                  op.name === 'launch_app'
                    ? ctx.sessionToLaunch((args as { app?: string }).app, args)
                    : ctx.session()
                ).catch(() => undefined);
          const r = activeRecording(ctx, s?.device.serial ?? ctx.selected);
          if (!r) return op.handler(args);
          let record: (() => FlowStep | undefined) | undefined;
          if (s && op.name === 'check_element') {
            const { read: _, ...check } = args;
            const st = must(op.step?.(check), 'the step of a check');
            if (st.action === 'wait_for') record = await waitRecord(s, st);
            if (st.action === 'assert') record = await assertRecord(s, st);
          }
          const out = await op.handler(args);
          const steps = record ? record() : toStep(args, out.data);
          addSteps(r, steps);
          return withLine(out, notReplayed(steps));
        },
      };
    },
  };
}
