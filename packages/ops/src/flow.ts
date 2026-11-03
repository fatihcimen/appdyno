import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import {
  nearest,
  reportProgress,
  selectIn,
  stateDir,
  throwIfCancelled,
  type Screen,
  type ScreenElement,
} from '@appdyno/core';
import {
  bestSelector,
  elementAt,
  fillApp,
  FlowError,
  junitXml,
  parseFlow,
  Recording,
  runSteps,
  toMaestro,
  valuesFor,
  type Executor,
  type Flag,
  type Flow,
  type FlowSelector,
  type FlowStep,
  type RecordingState,
  type RunFailure,
  type RunOptions,
  type RunResult,
  type StepOutcome,
  type TestCase,
  type TestSuite,
} from '@appdyno/flows';
import type { ErrorCode } from '@appdyno/protocol';
import { z } from 'zod';
import type { Answers } from './answers.js';
import type { ServerContext } from './context.js';
import { checkApp } from './policy.js';
import { FlowOut } from './schemas.js';
import type { Session } from './session.js';
import { WAIT_MS, type Step, type Steps } from './steps.js';
import { DESTRUCTIVE, defineOp, reply, ToolError, type Op, type ToolResult } from './tool.js';

/**
 * How long a replayed step waits for its target, and an assert for its check: a CI machine under load
 * is slower than the session it was recorded in, and a step that reads a settled screen too early fails
 * for nothing. A miss costs this long and then stops.
 */
const REPLAY_WAIT_MS = 10_000;
/** While recording: how long a selector's element may take to come, as `steps` allows. */
const AIM_WAIT_MS = 1_500;
const FLOW_FILE = /\.flow$/;
const DEFAULT_SWIPES = 10;

/** A target as the flat form the ops take. */
type Target = { ref?: string; x?: number; y?: number; selector?: FlowSelector };

const recordingFile = (serial: string) =>
  join(stateDir(), 'recordings', `${serial.replace(/[^\w.-]/g, '_')}.json`);

function loadRecording(ctx: ServerContext, serial: string): Recording | undefined {
  try {
    const state = JSON.parse(readFileSync(recordingFile(serial), 'utf8')) as RecordingState;
    return new Recording(state, ctx.policy.secrets);
  } catch {
    return undefined;
  }
}

/** A file per device, so that the commands of a recording may be separate processes; no secret is in it. */
function keepRecording(r: Recording) {
  const file = recordingFile(r.state.serial);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(r.state), { mode: 0o600 });
}

const unrecorded = (what: string): FlowStep => ({
  action: 'unrecorded',
  line: 0,
  args: { what },
  flags: [],
});

const defined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
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
  const active = (s: Session) => {
    const r = loadRecording(ctx, s.device.serial);
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

  const add = (r: Recording, step: FlowStep | undefined) => {
    if (!step) return;
    r.add(step);
    keepRecording(r);
  };

  /** An op with no step of its own, as a flow step; a read or a refused action is none. */
  const OPS: Record<
    string,
    (a: Record<string, unknown>, data: Record<string, unknown>) => FlowStep | undefined
  > = {
    launch_app: (a) => stepOf('launch', {}, { app: a.app as string | undefined }),
    terminate_app: (a) => stepOf('stop', {}, { app: a.app as string | undefined }),
    open_link: (a) => stepOf('open_link', {}, { url: a.url as string }),
    set_location: (a) => stepOf('set_location', {}, { lat: a.lat as number, lon: a.lon as number }),
    alert: (a, data) =>
      a.answer && String(data.done).startsWith('answered')
        ? stepOf('alert', {}, { answer: a.answer as string })
        : undefined,
    keyboard: (a, data) =>
      a.action === 'dismiss' && String(data.done).startsWith('closed')
        ? stepOf('hide_keyboard', {})
        : undefined,
    gesture: (a) =>
      a.kind === 'pinch' || a.kind === 'plan' ? unrecorded(`gesture ${String(a.kind)}`) : undefined,
    set_orientation: (a) => unrecorded(`set_orientation ${String(a.orientation)}`),
    clipboard: (a) => (a.text !== undefined ? unrecorded('clipboard') : undefined),
    device_setting: (a) =>
      a.value !== undefined || a.name === 'restore'
        ? unrecorded(`device_setting ${String(a.name)}`)
        : undefined,
    app: (a) =>
      a.action === 'list' || a.action === 'state'
        ? undefined
        : unrecorded(`app ${String(a.action)}`),
  };

  return {
    /** Around one step of `tap`, `steps` and the like. */
    through: async <T>(s: Session, st: Step, run: () => Promise<T>): Promise<T> => {
      const r = active(s);
      if (!r) return run();
      const record = await prepared(r, s, st);
      const out = await run();
      add(r, record());
      return out;
    },

    /** The op as the surfaces see it. */
    wrap: (op: Op): Op => {
      const toStep = OPS[op.name];
      const checks = op.name === 'wait_for' || op.name === 'assert';
      if (!toStep && !checks) return op;
      return {
        ...op,
        handler: async (args): Promise<ToolResult> => {
          // no device: the op itself says what is wrong
          const s = await ctx.session().catch(() => undefined);
          const r = s && active(s);
          if (!s || !r) return op.handler(args);
          let record: (() => FlowStep | undefined) | undefined;
          if (op.name === 'wait_for') record = await waitStep(s, args as never);
          if (op.name === 'assert') record = await assertStep(s, args as never);
          const out = await op.handler(args);
          if (out.data.met === false) return out;
          add(r, record ? record() : toStep!(args, out.data));
          return out;
        },
      };
    },
  };
}

const flagged = (flow: Flow) =>
  flow.steps.flatMap((st, i) => {
    const why = [
      ...st.flags,
      ...(st.action === 'unrecorded' ? [`not recorded: ${String(st.args.what)}`] : []),
    ];
    return why.length > 0 ? [`step ${i + 1}: ${why.join(', ')}`] : [];
  });

export const readFlow = (file: string): Flow => {
  if (!FLOW_FILE.test(file)) throw new ToolError(`a flow's file ends in .flow: ${file}`);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    throw new ToolError(`cannot read ${file}: ${(e as Error).message}`, 'NOT_FOUND');
  }
  try {
    return parseFlow(text);
  } catch (e) {
    if (e instanceof FlowError) throw new ToolError(`${file}: ${e.message}`);
    throw e;
  }
};

/** `NAME=value` words as a record. */
export function paramsOf(words: string[] = []): Record<string, string> {
  return Object.fromEntries(
    words.map((w) => {
      const at = w.indexOf('=');
      if (at < 1) throw new ToolError(`a parameter is NAME=value: ${w.split('=')[0]}`);
      return [w.slice(0, at), w.slice(at + 1)];
    }),
  );
}

/** One step as the op it runs through. */
function opCall(st: FlowStep): [string, Record<string, unknown>] {
  const a = st.args;
  const target = {
    ...(st.selector && { selector: st.selector }),
    ...(a.x !== undefined && { x: a.x, y: a.y }),
  };
  const flat = st.selector ?? {};
  switch (st.action) {
    case 'launch':
      return ['launch_app', defined({ app: a.app })];
    case 'stop':
      return ['terminate_app', defined({ app: a.app })];
    case 'tap':
      return ['tap', target];
    case 'long_press':
      return [
        'gesture',
        { kind: 'long_press', ...target, ...defined({ durationMs: a.durationMs }) },
      ];
    case 'double_tap':
      return ['gesture', { kind: 'double_tap', ...target }];
    case 'type':
      return [
        'type_text',
        { text: a.text, ...target, ...defined({ replace: a.replace, submit: a.submit }) },
      ];
    case 'press_key':
      return ['press_key', { key: a.key }];
    case 'swipe':
      return [
        'swipe',
        {
          direction: a.direction,
          ...target,
          ...defined({ distance: a.distance, durationMs: a.durationMs }),
        },
      ];
    case 'scroll_to':
      return [
        'scroll_to',
        { selector: st.selector, ...defined({ direction: a.direction, maxSwipes: a.maxSwipes }) },
      ];
    case 'wait_for':
      return [
        'wait_for',
        { ...flat, ...defined({ gone: a.gone }), timeoutMs: a.timeoutMs ?? REPLAY_WAIT_MS },
      ];
    case 'assert':
      return [
        'assert',
        {
          ...flat,
          ...defined({ check: a.check, equals: a.equals, expect: a.expect }),
          timeoutMs: a.timeoutMs ?? REPLAY_WAIT_MS,
        },
      ];
    case 'open_link':
      return ['open_link', { url: a.url }];
    case 'set_location':
      return ['set_location', { lat: a.lat, lon: a.lon }];
    case 'alert':
      return ['alert', { answer: a.answer }];
    case 'hide_keyboard':
      return ['keyboard', { action: 'dismiss' }];
    case 'unrecorded':
      throw new ToolError(
        `this action has no step and was not recorded: ${String(a.what)}. Replace or delete this line`,
      );
  }
}

/** They end on a settled screen with no time from the device (no lookup before, or several actions): all of the step is the time. */
const WHOLE_STEP = new Set(['launch', 'open_link', 'scroll_to']);
const READS_ONLY = new Set(['wait_for', 'assert']);

export type ReplayOptions = Pick<RunOptions, 'from' | 'onStep'> & {
  params?: Record<string, string>;
  /** Where a failure leaves its screenshot and tree. */
  evidence?: string;
};

/** Runs flows through the operations themselves, as an agent's calls would. */
export function flowRunner(
  ctx: ServerContext,
  ops: () => Record<string, Op>,
  { header, clean, show }: Answers,
  steps: Steps,
) {
  const opInput = (name: string, args: Record<string, unknown>, where: string) => {
    const p = ops()[name]!.input.safeParse(args);
    if (!p.success) throw new ToolError(`${where}: ${z.prettifyError(p.error)}`);
    return p.data as Record<string, unknown>;
  };

  /** Every step's arguments, before the first runs: a typo is not found at step 40. */
  const validate = (flow: Flow, file: string) => {
    for (const st of flow.steps) {
      if (st.action === 'unrecorded') continue;
      const [name, args] = opCall(st);
      opInput(name, args, `${file}:${st.line}`);
    }
  };

  const executor = (s: Session): Executor => ({
    prepare: async (st) => {
      if (st.args.screen) {
        const w = await steps.windowSize(s);
        if (st.args.screen !== `${w.w}x${w.h}`)
          throw new ToolError(
            `this step is for a ${String(st.args.screen)} screen and this one is ${w.w}x${w.h}: name its target in the flow`,
          );
      }
      if (!st.selector || READS_ONLY.has(st.action) || st.action === 'scroll_to') return;
      // no error here: if it never comes, the op itself refuses, with the nearest candidates
      await steps.waitFor(s, { ...st.selector, gone: false, timeoutMs: REPLAY_WAIT_MS });
    },
    act: async (st): Promise<StepOutcome> => {
      const [name, args] = opCall(st);
      const t0 = Date.now();
      const { data } = await ops()[name]!.handler(opInput(name, args, st.action));
      const whole = Date.now() - t0;
      if (data.met === false) {
        const screen = await s.read();
        const near = nearest(screen.list, st.selector?.text ?? st.selector?.id).map(steps.line);
        throw new ToolError(
          `${st.args.gone ? 'still there' : 'not shown'} after ${String(st.args.timeoutMs ?? REPLAY_WAIT_MS)} ms${near.length > 0 ? `; nearest: ${near.join('; ')}` : ''}`,
          'TIMEOUT',
        );
      }
      const died = data.appDied as { reason: string; file?: string } | undefined;
      if (died)
        throw new ToolError(
          `the app died: ${died.reason}${died.file ? ` (${died.file})` : ''}`,
          'APP_NOT_RUNNING',
        );
      const settledMs = WHOLE_STEP.has(st.action)
        ? whole
        : READS_ONLY.has(st.action)
          ? undefined
          : (data.settleMs as number | undefined);
      const warnings = data.warnings as string[] | undefined;
      return {
        ...(settledMs !== undefined && { settledMs }),
        ...(data.settled !== undefined && { settled: data.settled as boolean }),
        ...(data.changed !== undefined && { changed: data.changed as boolean }),
        ...(warnings?.length && { warnings }),
      };
    },
  });

  /** The failure's moment on disk; what cannot be had is left out, the failure already says enough. */
  const keepEvidence = async (s: Session, dir: string) => {
    mkdirSync(dir, { recursive: true });
    const out: string[] = [];
    const shot = await s.device
      .screenshot({ format: 'jpeg', quality: 80, maxPx: 1024 })
      .catch(() => undefined);
    if (shot) {
      out.push(join(dir, 'screen.jpg'));
      writeFileSync(out.at(-1)!, shot.data);
    }
    const tree = await s.device.tree().catch(() => undefined);
    if (tree) {
      out.push(join(dir, 'tree.json'));
      writeFileSync(
        out.at(-1)!,
        JSON.stringify(tree, (_k, v: unknown) => (typeof v === 'string' ? clean(v) : v), 1),
      );
    }
    return out;
  };

  /**
   * A flow on the session's device, with each step's time from action to settled. A secret's value is
   * hidden from all this run shows or saves, as a screen may hold it. `onStep` is the hook a measure of
   * each step takes (the journey performance suite).
   */
  const run = async (
    s: Session,
    flow: Flow,
    file: string,
    o: ReplayOptions = {},
  ): Promise<RunResult> => {
    if (loadRecording(ctx, s.device.serial)?.state.running)
      throw new ToolError('stop the recording first: a replay would be recorded in it');
    const from = o.from ?? 1;
    if (from < 1 || from > flow.steps.length)
      throw new ToolError(`from ${from}: this flow has steps 1 to ${flow.steps.length}`);
    validate(flow, file);
    let values: Record<string, string>;
    try {
      values = valuesFor(flow, o.params ?? {}, process.env, from);
    } catch (e) {
      throw new ToolError(`${file}: ${(e as Error).message}`);
    }
    if (flow.app) {
      s.appId = checkApp(ctx.policy, fillApp(flow.app, values));
      s.appPid = undefined;
    }
    const undo = ctx.hide(flow.secrets.flatMap((n) => values[n] ?? []));
    try {
      const result = await runSteps(flow, executor(s), {
        from,
        values,
        ...(o.onStep && { onStep: o.onStep }),
        checkpoint: (n, total, st) => {
          throwIfCancelled('flow');
          reportProgress(`step ${n} of ${total}: ${st.action}`);
        },
      });
      const f = result.failure;
      if (f) {
        f.message = clean(f.message);
        const screen = await s.read().catch(() => undefined);
        if (screen) {
          show(s, screen);
          f.screen = header(s, screen);
        }
        if (o.evidence) f.saved = await keepEvidence(s, o.evidence);
      }
      return result;
    } finally {
      undo();
    }
  };

  const lineOf = (r: RunResult['steps'][number]) =>
    `${r.n}. ${r.step}: ${r.settledMs !== undefined ? `settled in ${r.settledMs} ms` : `${r.ms} ms`}${r.settled === false ? ' (the screen may still be changing)' : ''}`;

  const failureText = (file: string, f: RunFailure) =>
    [
      `${file}:${f.line}: step ${f.n} failed: ${f.step}`,
      f.message,
      ...(f.screen ? [f.screen] : []),
      `to go on from here: appdyno flow run ${file} --from ${f.n}`,
    ].join('\n');

  return { run, lineOf, failureText };
}

export type FlowRunner = ReturnType<typeof flowRunner>;

export function flowOps(ctx: ServerContext, runner: FlowRunner): Op[] {
  const done = (t: string, data: Record<string, unknown> = {}) => reply(t, { done: t, ...data });
  return [
    defineOp({
      name: 'flow',
      title: 'Flow',
      description:
        'Record your actions; replay them with no model. action: start, stop, save (file, overwrite), run (file, from: a step, params: NAME=value; a miss stops with the nearest), export (file, to Maestro YAML).',
      input: z
        .object({
          action: z.enum(['start', 'stop', 'save', 'run', 'export']),
          file: z.string().max(1_000).optional(),
          from: z.number().refine(Number.isInteger, 'a step number').optional(),
          params: z.array(z.string().max(2_000)).optional(),
          overwrite: z.boolean().optional(),
        })
        .strict(),
      output: FlowOut,
      annotations: DESTRUCTIVE,
      run: async ({ action, file, from, params, overwrite }) => {
        const need = () => {
          if (!file) throw new ToolError(`${action} needs file: a path ending in .flow`);
          if (!FLOW_FILE.test(file)) throw new ToolError(`a flow's file ends in .flow: ${file}`);
          return file;
        };
        if (action === 'export') {
          try {
            const yaml = toMaestro(readFlow(need()));
            return reply(yaml, { done: 'exported' });
          } catch (e) {
            if (e instanceof FlowError) throw new ToolError(e.message);
            throw e;
          }
        }
        const s = await ctx.session();
        const serial = s.device.serial;
        const held = loadRecording(ctx, serial);
        switch (action) {
          case 'start': {
            if (held?.state.running)
              throw new ToolError(`a recording is running on ${serial}: stop it first`);
            const pkg = s.appId;
            keepRecording(
              new Recording(
                { serial, running: true, steps: [], known: [], ...(pkg && { app: pkg }) },
                ctx.policy.secrets,
              ),
            );
            return done(`recording on ${serial}${pkg ? ` (${pkg})` : ''}`);
          }
          case 'stop': {
            if (!held) throw new ToolError('no recording to stop: flow start begins one');
            held.state.running = false;
            keepRecording(held);
            const notes = flagged(held.flow());
            return reply(
              [
                held.state.steps.length > 0 ? held.text() : 'nothing was recorded',
                ...notes.map((n) => `look at ${n}`),
              ].join('\n'),
              { done: 'stopped', steps: held.state.steps.length, flagged: notes },
            );
          }
          case 'save': {
            if (!held) throw new ToolError('no recording to save: flow start begins one');
            if (held.state.steps.length === 0) throw new ToolError('nothing was recorded yet');
            const path = need();
            try {
              mkdirSync(dirname(path), { recursive: true });
              writeFileSync(path, held.text(), { flag: overwrite ? 'w' : 'wx' });
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code === 'EEXIST')
                throw new ToolError(`${path} exists: overwrite true replaces it`);
              throw new ToolError(`cannot write ${path}: ${(e as Error).message}`);
            }
            const notes = flagged(held.flow());
            const t = `saved ${held.state.steps.length} steps to ${path}`;
            return reply([t, ...notes.map((n) => `look at ${n}`)].join('\n'), {
              done: t,
              steps: held.state.steps.length,
              flagged: notes,
            });
          }
          case 'run': {
            const path = need();
            const result = await runner.run(s, readFlow(path), path, {
              params: paramsOf(params),
              ...(from !== undefined && { from }),
            });
            if (result.failure)
              throw new ToolError(
                runner.failureText(path, result.failure),
                (result.failure.code ?? 'NOT_FOUND') as ErrorCode,
                result.failure.hint,
              );
            const t = result.steps.map(runner.lineOf).join('\n');
            return reply(`${t}\npassed: ${result.steps.length} steps`, {
              done: 'passed',
              steps: result.steps.length,
              timings: result.steps,
            });
          }
        }
      },
    }),
  ];
}

/** The `.flow` files the words name: a file, or every one under a directory, in name order. */
export function flowFiles(paths: string[]): string[] {
  const files = paths.flatMap((p) => {
    if (!existsSync(p)) throw new ToolError(`no such file or directory: ${p}`, 'NOT_FOUND');
    if (!statSync(p).isDirectory()) return [p];
    return (readdirSync(p, { recursive: true }) as string[])
      .filter((f) => extname(f) === '.flow')
      .sort()
      .map((f) => join(p, f));
  });
  // a CI job that found nothing to run has not passed
  if (files.length === 0) throw new ToolError(`no .flow files in ${paths.join(', ')}`, 'NOT_FOUND');
  return files;
}

export type TestOptions = {
  files: string[];
  /** In order; none: the context's default device. */
  devices: string[];
  artifacts: string;
  junit: string;
  params?: Record<string, string>;
  log?: (line: string) => void;
};

/** A path's part from a serial or a file's name, which may hold any character. */
const safe = (s: string) => s.replace(/[^\w.-]/g, '_');
const firstLine = (s: string) => s.split('\n')[0]!;

/**
 * Every file on every device, one after another. A failure leaves the screenshot and tree of its moment
 * under `artifacts`, and the next file still runs. A screenshot shows what the screen shows, a secret
 * typed into a plain field included.
 */
export async function runTests(
  ctx: ServerContext,
  runner: FlowRunner,
  o: TestOptions,
): Promise<{ passed: boolean; suites: TestSuite[] }> {
  const log = o.log ?? (() => undefined);
  const suites: TestSuite[] = [];
  for (const device of o.devices.length > 0 ? o.devices : [undefined]) {
    const cases: TestCase[] = [];
    let s: Session | undefined;
    let openError: Error | undefined;
    try {
      s = device ? await ctx.use(device) : await ctx.session();
    } catch (e) {
      openError = e as Error;
    }
    const name = s?.device.serial ?? device ?? 'device';
    log(`${name}:`);
    for (const file of o.files) {
      const t0 = Date.now();
      const label = basename(file);
      let result: RunResult | undefined;
      let error = openError;
      if (s) {
        try {
          result = await runner.run(s, readFlow(file), file, {
            evidence: join(o.artifacts, safe(name), safe(label)),
            ...(o.params && { params: o.params }),
          });
        } catch (e) {
          // a file that does not parse, a value missing: this file's failure, not the run's
          error = e as Error;
        }
      }
      const ms = Date.now() - t0;
      const out = result?.steps.map(runner.lineOf).join('\n');
      if (result?.passed) {
        log(`  ok   ${label} (${result.steps.length} steps, ${ms} ms)`);
        cases.push({ name: label, ms, ...(out && { out }) });
        continue;
      }
      const f = result?.failure;
      const message = f
        ? `line ${f.line}, step ${f.n}: ${firstLine(f.message)}`
        : firstLine(error?.message ?? 'failed');
      const detail = [
        f ? runner.failureText(file, f) : (error?.message ?? ''),
        ...(f?.saved ?? []).map((x) => `saved ${x}`),
      ].join('\n');
      log(`  FAIL ${label}: ${message}`);
      for (const x of f?.saved ?? []) log(`       ${x}`);
      cases.push({ name: label, ms, failure: { message, detail }, ...(out && { out }) });
    }
    suites.push({ name, cases });
  }
  mkdirSync(dirname(o.junit), { recursive: true });
  writeFileSync(o.junit, junitXml(suites));
  return { passed: suites.every((x) => x.cases.every((c) => !c.failure)), suites };
}
