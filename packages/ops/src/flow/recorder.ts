import { type Screen, type ScreenElement, selectIn } from '@appdyno/core';
import { type FlowSelector, type FlowStep, type Flag, Recording } from '@appdyno/flows';
import type { ServerContext } from '../context.js';
import type { Session } from '../session.js';
import { SCROLLER_SWIPES } from '../perf/shared.js';
import { SCROLL_MAX, type Step, WAIT_MS } from '../step-schemas.js';
import { NO_MATCH_WAIT_MS } from '../steps.js';
import { byRef } from '../targets.js';
import type { Op, ToolResult } from '../tool.js';
import { BY_STEP, NOT_ACTIONS } from '../tool-kinds.js';
import { type Aim, aimAt, fieldName, named, stepOf, unrecorded } from './aim.js';
import { activeRecording, addSteps, defined } from './shared.js';

/** A target as the flat form the ops take. */
type Target = { ref?: string; x?: number; y?: number; selector?: FlowSelector };

/** What an op that ran comes to in a flow: its arguments and answer, as steps. */
type ToStep = (
  a: Record<string, unknown>,
  data: Record<string, unknown>,
) => FlowStep | FlowStep[] | undefined;

/** What an op that can change things does when it only looks. */
const LOOKS: Record<string, string[]> = {
  app: ['list', 'state'],
  inspector: ['list'],
  network: ['paths', 'read'],
  webview: ['pages', 'elements'],
  react_native: ['targets', 'logs'],
};

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
  const durationMs = st.action === 'long_press' ? st.durationMs : undefined;
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
      return () => unrecorded('gesture drag');
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

/**
 * A measure is the agent measuring, not the journey: its numbers come from `appdyno test --measure`. What it does to
 * the screen stays, as the plain steps that do the same, so that the next step finds what it found, and nothing stops
 * a replay: a cold start is a stop and a launch, a scroll its swipes.
 */
const swipes = (a: Record<string, unknown>, count: number) =>
  Array.from({ length: count }, () =>
    stepOf('swipe', {}, { direction: (a.direction ?? a.scroll) as string }),
  );
const restarts = (
  a: Record<string, unknown>,
  how: Record<string, string | string[] | undefined> = {},
) => [
  stepOf('stop', {}, { app: a.app as string | undefined }),
  stepOf('launch', {}, { app: a.app as string | undefined, ...how }),
];
const MEASURES: Record<string, ToStep> = {
  perf_launch: (a) =>
    a.mode === 'cold' ? restarts(a) : stepOf('launch', {}, { app: a.app as string | undefined }),
  perf_scroll: (a, data) => {
    const count = a.swipes as number;
    const back = { direction: a.direction === 'up' ? 'down' : 'up' };
    const rounds = (data.rounds as { rewound?: boolean }[]).map((round) => [
      ...(round.rewound ? swipes(back, count) : []),
      ...swipes(a, count),
    ]);
    return rounds.flat();
  },
  perf_trace: (a) => [
    ...(String(a.what).startsWith('xct_') ? restarts(a) : []),
    ...(a.scroll ? swipes(a, SCROLLER_SWIPES) : []),
  ],
  perf_profile: (a) => (a.scroll ? swipes(a, SCROLLER_SWIPES) : undefined),
  // a gate reads what is kept, and refuses to look at a device while a recording runs
  perf_compare: () => undefined,
};

/** An op with no step of its own, as a flow step; a refused action is none, and any other op stops a replay. */
const OPS: Record<string, ToStep> = {
  ...MEASURES,
  // a launch that started the app is a start in a replay too, where a plain launch brings a running app forward as it is;
  // a restart, arguments and an environment stop a running app first on every platform: a start, whether it ran or not
  launch_app: (a, data) => {
    const env = a.env as Record<string, string> | undefined;
    const how = {
      language: a.language as string | undefined,
      arg: a.args as string[] | undefined,
      env: env && Object.entries(env).map(([k, v]) => `${k}=${v}`),
    };
    return data.wasRunning === false || a.restart || a.args || a.env
      ? restarts(a, how)
      : stepOf(
          'launch',
          { flags: data.wasRunning ? ['running'] : [] },
          { app: a.app as string | undefined, language: how.language },
        );
  },
  terminate_app: (a) => stepOf('stop', {}, { app: a.app as string | undefined }),
  // what an app opens is read, and nothing opened: no step
  open_link: (a) =>
    a.links
      ? undefined
      : stepOf(
          'open_link',
          {},
          { url: a.url as string | undefined, settings: a.settings as string | undefined },
        ),
  set_location: (a) => stepOf('set_location', {}, { lat: a.lat as number, lon: a.lon as number }),
  alert: (a, data) =>
    data.answered !== undefined ? stepOf('alert', {}, { answer: a.answer as string }) : undefined,
  keyboard: (_a, data) => (data.closed ? stepOf('hide_keyboard', {}) : undefined),
  gesture: (a) =>
    a.kind === 'pinch' || a.kind === 'plan' ? unrecorded(`gesture ${a.kind}`) : undefined,
  set_orientation: (a) => unrecorded(`set_orientation ${String(a.orientation)}`),
  clipboard: (a) => (a.text !== undefined ? unrecorded('clipboard') : undefined),
  device_setting: (a) =>
    a.value !== undefined || a.name === 'restore'
      ? unrecorded(`device_setting ${String(a.name)}`)
      : undefined,
};

const unknownOp = (name: string) => (a: Record<string, unknown>) => {
  // an op's action is one of its words, by its schema
  const action = typeof a.action === 'string' ? a.action : '';
  return LOOKS[name]?.includes(action)
    ? undefined
    : unrecorded(action ? `${name} ${action}` : name);
};

/**
 * The one place the recorder touches the operations: every step an action runs passes `through`, every
 * other op passes `wrap`. Nothing is written unless the action succeeded.
 */
export function flowRecorder(ctx: ServerContext) {
  return {
    /** Around one step of `tap`, `steps` and the like. */
    through: async <T>(s: Session, st: Step, run: () => Promise<T>): Promise<T> => {
      const r = activeRecording(ctx, s.device.serial);
      if (!r) return run();
      const record = await recordOf(r, s, st);
      const out = await run();
      addSteps(r, record());
      return out;
    },

    /** The op as the surfaces see it. */
    wrap: (op: Op): Op => {
      const checks = op.name === 'wait_for' || op.name === 'assert';
      const elsewhere = BY_STEP.has(op.name) || NOT_ACTIONS.has(op.name);
      if (!checks && (elsewhere || op.annotations.readOnlyHint)) return op;
      const toStep = OPS[op.name] ?? unknownOp(op.name);
      return {
        ...op,
        handler: async (args): Promise<ToolResult> => {
          // no device: the op itself says what is wrong; Metro needs none, so none is opened for it
          const s =
            op.name === 'react_native'
              ? undefined
              : await (
                  op.name === 'launch_app'
                    ? ctx.sessionToLaunch((args as { app?: string }).app, args)
                    : ctx.session()
                ).catch(() => undefined);
          const r = activeRecording(ctx, s?.device.serial ?? ctx.selected);
          if (!r) return op.handler(args);
          let record: (() => FlowStep | undefined) | undefined;
          if (s && op.name === 'wait_for') record = await waitRecord(s, args as never);
          if (s && op.name === 'assert') record = await assertRecord(s, args as never);
          const out = await op.handler(args);
          addSteps(r, record ? record() : toStep(args, out.data));
          return out;
        },
      };
    },
  };
}
