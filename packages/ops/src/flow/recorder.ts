import { type Screen, type ScreenElement, selectIn } from '@appdyno/core';
import {
  type FlowSelector,
  type FlowStep,
  type Flag,
  bestSelector,
  elementAt,
  Recording,
} from '@appdyno/flows';
import type { ServerContext } from '../context.js';
import { NOT_STEPS } from '../report.js';
import type { Session } from '../session.js';
import { SCROLLER_SWIPES } from '../perf/shared.js';
import { type Step, WAIT_MS } from '../step-schemas.js';
import type { Op, ToolResult } from '../tool.js';
import { defined, loadRecording, keepRecording } from './shared.js';

/** While recording: how long a selector's element may take to come, as `steps` allows. */
const AIM_WAIT_MS = 1_500;

const DEFAULT_SWIPES = 10;

/** A target as the flat form the ops take. */
type Target = { ref?: string; x?: number; y?: number; selector?: FlowSelector };

/** What an op that ran comes to in a flow: its arguments and answer, as steps. */
type ToStep = (
  a: Record<string, unknown>,
  data: Record<string, unknown>,
) => FlowStep | FlowStep[] | undefined;

const unrecorded = (what: string): FlowStep => ({
  action: 'unrecorded',
  line: 0,
  args: { what },
  flags: [],
});

/** No action of a flow, as they pick the device, film it or run the recording; nor is what a report leaves out. */
const NOT_ACTIONS = new Set([...NOT_STEPS, 'use_device', 'record', 'flow']);

/** Each step these run passes `through`. */
const BY_STEP = new Set(['tap', 'swipe', 'scroll_to', 'type_text', 'press_key', 'steps']);

/** What an op that can change things does when it only looks. */
const LOOKS: Record<string, string[]> = {
  app: ['list', 'state'],
  network: ['paths', 'read'],
  webview: ['pages', 'elements'],
  react_native: ['targets', 'logs'],
};

type FlatSelector = {
  text?: string | undefined;
  id?: string | undefined;
  role?: string | undefined;
  index?: number | undefined;
};

const flatSelector = (a: FlatSelector): FlowSelector | undefined =>
  a.text || a.id || a.role
    ? defined({ id: a.id, role: a.role, text: a.text, index: a.index })
    : undefined;

/**
 * The one place the recorder touches the operations: every step an action runs passes `through`, every
 * other op passes `wrap`. Nothing is written unless the action succeeded.
 */
export function flowRecorder(ctx: ServerContext) {
  const active = (serial: string | undefined) => {
    const r = serial === undefined ? undefined : loadRecording(ctx, serial);
    return r?.state.running ? r : undefined;
  };

  const size = async (s: Session) =>
    (await s.current()).window ??
    (s.device.hello && { w: s.device.hello.screen.w, h: s.device.hello.screen.h });

  /** A target named for later, and the screen it was named on. */
  type Aim = {
    screen?: Screen | undefined;
    element?: ScreenElement | undefined;
    selector?: FlowSelector;
    args?: Record<string, string | number>;
    flags?: Flag[];
  };

  const named = (screen: Screen, e: ScreenElement) => {
    const c = bestSelector(screen, e);
    return {
      selector: c.selector,
      flags: (c.ambiguous !== undefined ? ['ambiguous'] : []) as Flag[],
    };
  };

  const coordinates = async (s: Session, p: { x: number; y: number }) => {
    const w = await size(s);
    return {
      args: { x: p.x, y: p.y, ...(w && { screen: `${w.w}x${w.h}` }) },
      flags: ['coordinates'] as Flag[],
    };
  };

  /** A target on the screen the action is about to act on: a selector when anything names it, else flagged coordinates. */
  const aim = async (s: Session, t: Target): Promise<Aim> => {
    let screen: Screen | undefined;
    let e: ScreenElement | undefined;
    if (t.ref) {
      const has = (x: Screen) => x.list.find((y) => y.ref === t.ref);
      screen = await s.current();
      if (!has(screen)) screen = (await s.until((x) => !!has(x), AIM_WAIT_MS)).screen;
      e = screen && has(screen);
    } else if (t.selector) {
      const sel = t.selector;
      screen = (await s.until((x) => selectIn(x.list, sel).length > 0, AIM_WAIT_MS)).screen;
      e = screen && selectIn(screen.list, sel)[sel.index ?? 0];
    } else if (t.x !== undefined && t.y !== undefined) {
      screen = await s.current();
      const w = await size(s);
      e = w && elementAt(screen.list, { x: t.x, y: t.y }, w);
      if (!e) return { screen, ...(await coordinates(s, { x: t.x, y: t.y })) };
    } else return { screen: await s.current() };
    if (!screen || !e) return { screen };
    return { screen, element: e, ...named(screen, e) };
  };

  const stepOf = (
    action: FlowStep['action'],
    a: Aim,
    args: Record<string, string | number | boolean | undefined> = {},
  ): FlowStep => ({
    action,
    line: 0,
    ...(a.selector && { selector: a.selector }),
    args: defined({ ...args, ...a.args }),
    flags: a.flags ?? [],
  });

  /** A step's record, known before it runs as the screen is about to change. */
  const prepared = async (
    r: Recording,
    s: Session,
    st: Step,
  ): Promise<() => FlowStep | undefined> => {
    switch (st.action) {
      case 'tap':
      case 'double_tap':
      case 'long_press': {
        const a = await aim(s, st);
        const durationMs = st.action === 'long_press' ? st.durationMs : undefined;
        return () =>
          a.selector || a.args
            ? stepOf(st.action, a, { durationMs })
            : unrecorded(`${st.action} of an element gone from the screen`);
      }
      case 'drag':
        return () => unrecorded('gesture drag');
      case 'swipe': {
        const hasTarget = !!(st.ref || st.selector || st.x !== undefined);
        const a = hasTarget ? await aim(s, st) : {};
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
      case 'type_text': {
        const hasTarget = !!(st.ref || st.selector || st.x !== undefined);
        const a = await aim(s, st);
        const el = a.screen?.elements.find((x) =>
          hasTarget ? x.ref === a.element?.ref : x.focused,
        );
        if (el?.password) r.learnSecret(st.text, el.identifier?.replace(/^[\w.]*:id\//, ''));
        return () =>
          stepOf('type', hasTarget ? a : {}, {
            text: st.text,
            replace: st.replace || undefined,
            submit: st.submit || undefined,
          });
      }
      case 'press_key':
        return () => stepOf('press_key', {}, { key: st.key });
      case 'wait_for':
        return waitStep(s, st);
      case 'assert':
        return assertStep(s, st);
      case 'scroll_to':
        // shortcut: x, y (which of several lists) is not kept, as it holds for one screen size; replay
        // scrolls the biggest list and stops if that was the wrong one
        return () =>
          stepOf(
            'scroll_to',
            {
              selector: st.selector,
              flags: st.selector.index !== undefined ? ['ambiguous'] : [],
            },
            {
              direction: st.direction === 'up' ? undefined : st.direction,
              maxSwipes: st.maxSwipes === DEFAULT_SWIPES ? undefined : st.maxSwipes,
            },
          );
    }
  };

  /** A check keeps the agent's words, which are what it checks; a ref is named for later. */
  const looked = async (
    s: Session,
    a: { ref?: string | undefined } & FlatSelector,
  ): Promise<Aim> => {
    if (a.ref) return aim(s, { ref: a.ref });
    const selector = flatSelector(a);
    return { ...(selector && { selector, flags: a.index !== undefined ? ['ambiguous'] : [] }) };
  };

  const waitStep = async (
    s: Session,
    a: { ref?: string | undefined; gone: boolean; timeoutMs: number } & FlatSelector,
  ) => {
    const at = await looked(s, a);
    return () =>
      at.selector
        ? stepOf('wait_for', at, {
            gone: a.gone || undefined,
            timeoutMs: a.timeoutMs === WAIT_MS ? undefined : a.timeoutMs,
          })
        : undefined;
  };

  const assertStep = async (
    s: Session,
    a: {
      ref?: string | undefined;
      check: string;
      equals?: string | undefined;
      expect: boolean;
      timeoutMs: number;
    } & FlatSelector,
  ) => {
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
  };

  const add = (r: Recording, step: FlowStep | FlowStep[] | undefined) => {
    const steps = [step ?? []].flat();
    for (const st of steps) r.add(st);
    if (steps.length) keepRecording(r);
  };

  /**
   * A measure is the agent measuring, not the journey: its numbers come from `appdyno test --measure`. What it does to
   * the screen stays, as the plain steps that do the same, so that the next step finds what it found, and nothing stops
   * a replay: a cold start is a stop and a launch, a scroll its swipes.
   */
  const swipes = (a: Record<string, unknown>, count: number) =>
    Array.from({ length: count }, () =>
      stepOf('swipe', {}, { direction: (a.direction ?? a.scroll) as string }),
    );
  const restarts = (a: Record<string, unknown>) => [
    stepOf('stop', {}, { app: a.app as string | undefined }),
    stepOf('launch', {}, { app: a.app as string | undefined }),
  ];
  const measureOps: Record<string, ToStep> = {
    perf_launch: (a) =>
      a.mode === 'cold' ? restarts(a) : stepOf('launch', {}, { app: a.app as string | undefined }),
    perf_scroll: (a, data) => [
      ...(data.relaunched ? restarts(a) : []),
      ...swipes(a, (a.swipes as number) * (a.repeats as number)),
    ],
    perf_trace: (a, data) => [
      ...(data.relaunched || String(a.what).startsWith('xct_') ? restarts(a) : []),
      ...(a.scroll ? swipes(a, SCROLLER_SWIPES) : []),
    ],
    perf_profile: (a) => (a.scroll ? swipes(a, SCROLLER_SWIPES) : undefined),
  };

  /** An op with no step of its own, as a flow step; a refused action is none, and any other op stops a replay. */
  const OPS: Record<string, ToStep> = {
    ...measureOps,
    launch_app: (a) => stepOf('launch', {}, { app: a.app as string | undefined }),
    terminate_app: (a) => stepOf('stop', {}, { app: a.app as string | undefined }),
    open_link: (a) => stepOf('open_link', {}, { url: a.url as string }),
    set_location: (a) => stepOf('set_location', {}, { lat: a.lat as number, lon: a.lon as number }),
    alert: (a, data) =>
      data.answered !== undefined ? stepOf('alert', {}, { answer: a.answer as string }) : undefined,
    keyboard: (_a, data) => (data.closed ? stepOf('hide_keyboard', {}) : undefined),
    gesture: (a) =>
      a.kind === 'pinch' || a.kind === 'plan' ? unrecorded(`gesture ${String(a.kind)}`) : undefined,
    set_orientation: (a) => unrecorded(`set_orientation ${String(a.orientation)}`),
    clipboard: (a) => (a.text !== undefined ? unrecorded('clipboard') : undefined),
    device_setting: (a) =>
      a.value !== undefined || a.name === 'restore'
        ? unrecorded(`device_setting ${String(a.name)}`)
        : undefined,
  };

  const unknownOp = (name: string) => (a: Record<string, unknown>) =>
    LOOKS[name]?.includes(String(a.action))
      ? undefined
      : unrecorded(a.action ? `${name} ${String(a.action)}` : name);

  return {
    /** Around one step of `tap`, `steps` and the like. */
    through: async <T>(s: Session, st: Step, run: () => Promise<T>): Promise<T> => {
      const r = active(s.device.serial);
      if (!r) return run();
      const record = await prepared(r, s, st);
      const out = await run();
      add(r, record());
      return out;
    },

    /** The op as the surfaces see it. */
    wrap: (op: Op): Op => {
      const checks = op.name === 'wait_for' || op.name === 'assert';
      const elsewhere = BY_STEP.has(op.name) || NOT_ACTIONS.has(op.name);
      // what is called a read may still move the screen, as a profile scrolling meanwhile
      if (!checks && (elsewhere || (op.annotations.readOnlyHint && !OPS[op.name]))) return op;
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
                    ? ctx.sessionToLaunch((args as { app?: string }).app)
                    : ctx.session()
                ).catch(() => undefined);
          const r = active(s?.device.serial ?? ctx.selected);
          if (!r) return op.handler(args);
          let record: (() => FlowStep | undefined) | undefined;
          if (s && op.name === 'wait_for') record = await waitStep(s, args as never);
          if (s && op.name === 'assert') record = await assertStep(s, args as never);
          const out = await op.handler(args);
          if (out.data.met === false) return out;
          add(r, record ? record() : toStep(args, out.data));
          return out;
        },
      };
    },
  };
}
