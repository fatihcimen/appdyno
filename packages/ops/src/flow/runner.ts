import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { must, nearest, throwIfCancelled, reportProgress } from '@appdyno/core';
import {
  type FlowStep,
  type RunOptions,
  type Flow,
  type Executor,
  type StepOutcome,
  type StepResult,
  type RunResult,
  valuesFor,
  fillApp,
  runSteps,
  type RunFailure,
} from '@appdyno/flows';
import { z } from 'zod';
import type { Answers } from '../answers.js';
import { asStepBegan, DIED_HINT, diedLine, diedUnder } from '../app-death.js';
import type { ServerContext } from '../context.js';
import { checkApp } from '../policy.js';
import { LOOKS_ONLY } from '../step-schemas.js';
import type { ActionOut } from '../schemas.js';
import type { Session } from '../session.js';
import type { Steps } from '../steps.js';
import { keyboardFirst } from '../keyboard.js';
import { refused, ToolError, type Op } from '../tool.js';
import { defined, loadRecording } from './shared.js';

/**
 * How long a replayed step waits for its target, and an assert for its check: a CI machine under load
 * is slower than the session it was recorded in, and a step that reads a settled screen too early fails
 * for nothing. A miss costs this long and then stops.
 */
const REPLAY_WAIT_MS = 10_000;

/** One step as the op it runs through. */
function opCall(st: FlowStep): [string, Record<string, unknown>] {
  const a = st.args;
  const target = {
    ...(st.selector && { selector: st.selector }),
    ...(a.x !== undefined && { x: a.x, y: a.y }),
  };
  const flat = st.selector ?? {};
  switch (st.action) {
    case 'launch': {
      // arguments and an environment are the app tool's; a language with them is refused by its schema
      const arg = a.arg as string[] | undefined;
      const env = a.env as string[] | undefined;
      if (!arg && !env) return ['launch_app', defined({ app: a.app, language: a.language })];
      const pairs = env?.map((e): [string, string] => [
        e.slice(0, e.indexOf('=')),
        e.slice(e.indexOf('=') + 1),
      ]);
      return [
        'app',
        defined({
          action: 'launch',
          app: a.app,
          args: arg,
          env: pairs && Object.fromEntries(pairs),
          language: a.language,
        }),
      ];
    }
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
      return ['press_key', { key: a.key, ...defined({ count: a.count }) }];
    case 'swipe':
      return [
        'swipe',
        {
          direction: a.direction,
          ...target,
          ...defined({ distance: a.distance, durationMs: a.durationMs, exact: a.exact }),
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
      return ['open_link', defined({ url: a.url, settings: a.settings })];
    case 'set_location':
      return ['set_location', { lat: a.lat, lon: a.lon }];
    case 'alert':
      return ['alert', { answer: a.answer }];
    case 'hide_keyboard':
      return ['keyboard', { action: 'dismiss' }];
    case 'unrecorded':
      throw new ToolError(
        `this action has no step and was not recorded: ${String(a.what)}. Replace or delete this line`,
        'UNSUPPORTED',
      );
    case 'run':
      throw new ToolError(
        `${String(a.file)} was not read in: run a flow from its file`,
        'INVALID_ARGUMENT',
      );
  }
}

/** They end on a settled screen with no time from the device (no lookup before, or several actions): all of the step is the time. */
const WHOLE_STEP = new Set(['launch', 'open_link', 'scroll_to']);

/** What a step took: the device's own count from action to settled where it has one, else the action on this Mac's clock. */
export const stepTime = (action: FlowStep['action'], r: StepResult) =>
  !WHOLE_STEP.has(action) && r.settledMs !== undefined
    ? { ms: r.settledMs, throughHost: false }
    : { ms: r.actMs ?? r.ms, throughHost: true };

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
    const p = must(ops()[name], `the op ${name}`).input.safeParse(args);
    if (!p.success)
      throw new ToolError(`${where}: ${z.prettifyError(p.error)}`, 'INVALID_ARGUMENT');
    return p.data;
  };

  /** Every step's arguments, before the first runs: a typo is not found at step 40. */
  const validate = (flow: Flow, file: string) => {
    for (const st of flow.steps) {
      if (st.action === 'unrecorded') continue;
      const [name, args] = opCall(st);
      opInput(name, args, `${st.file ?? file}:${st.line}`);
    }
  };

  const prepare = async (s: Session, st: FlowStep) => {
    if (st.args.screen) {
      const w = await steps.windowSize(s);
      if (st.args.screen !== `${w.w}x${w.h}`)
        throw new ToolError(
          `this step is for a ${String(st.args.screen)} screen and this one is ${w.w}x${w.h}: name its target in the flow`,
          'INVALID_ARGUMENT',
        );
    }
    if (!st.selector || LOOKS_ONLY.has(st.action) || st.action === 'scroll_to') return;
    await keyboardFirst(s, st.selector);
    // no error here: if it never comes, the op itself refuses, with the nearest candidates
    await steps.waitFor(s, { ...st.selector, gone: false, timeoutMs: REPLAY_WAIT_MS });
    await steps.holdsStill(s, st.selector);
  };

  const act = async (s: Session, st: FlowStep): Promise<StepOutcome> => {
    const [name, args] = opCall(st);
    const t0 = Date.now();
    const op = must(ops()[name], `the op ${name}`);
    const answered = await op.handler(opInput(name, args, st.action)).catch(async (e: unknown) => {
      if (!(e instanceof ToolError)) throw e;
      // a prompt comes once: a run after the one that answered it finds none, and that is no failure of the run
      if (st.action === 'alert' && e.code === 'NOT_FOUND') return undefined;
      if (st.action !== 'wait_for' || e.code !== 'TIMEOUT') throw e;
      const screen = await s.read();
      const near = nearest(screen.list, st.selector?.text ?? st.selector?.id).map(steps.line);
      throw new ToolError(
        `${st.args.gone ? 'still there' : 'not shown'} after ${String(st.args.timeoutMs ?? REPLAY_WAIT_MS)} ms${near.length > 0 ? `; nearest: ${near.join('; ')}` : ''}`,
        'TIMEOUT',
      );
    });
    const data = (answered?.data ?? {}) as Partial<ActionOut>;
    const whole = Date.now() - t0;
    const settledMs = WHOLE_STEP.has(st.action)
      ? whole
      : LOOKS_ONLY.has(st.action)
        ? undefined
        : data.settleMs;
    return {
      actMs: whole,
      ...(settledMs !== undefined && { settledMs }),
      ...(data.settled !== undefined && { settled: data.settled }),
      ...(data.changed !== undefined && { changed: data.changed }),
      ...(data.warnings?.length && { warnings: data.warnings }),
    };
  };

  /** The app as the step began, and when the step before it began: a step that fails as the app is gone failed for its death. */
  type Was = ReturnType<typeof asStepBegan> & { since: number; began: number };

  // the run's failure is read from what these throw, and a replay from code has no op around it
  const executor = (s: Session, was: Was): Executor => ({
    prepare: (st) => {
      Object.assign(was, {
        ...asStepBegan(s, s.fresh?.foreground),
        since: was.began,
        began: Date.now(),
      });
      return prepare(s, st).catch(refused);
    },
    act: (st) => act(s, st).catch(refused),
  });

  /** The failure's moment on disk; what cannot be had is left out, the failure already says enough. */
  const keepEvidence = async (s: Session, dir: string) => {
    mkdirSync(dir, { recursive: true });
    const out: string[] = [];
    const shot = await s.device
      .screenshot({ format: 'jpeg', quality: 80, maxPx: 1024 })
      .catch(() => undefined);
    if (shot) {
      const file = join(dir, 'screen.jpg');
      out.push(file);
      writeFileSync(file, shot.data);
    }
    const tree = await s.device.tree().catch(() => undefined);
    if (tree) {
      const file = join(dir, 'tree.json');
      out.push(file);
      writeFileSync(
        file,
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
      throw new ToolError(
        'stop the recording first: a replay would be recorded in it',
        'INVALID_ARGUMENT',
      );
    const from = o.from ?? 1;
    if (from < 1 || from > flow.steps.length)
      throw new ToolError(
        `from ${from}: this flow has steps 1 to ${flow.steps.length}`,
        'INVALID_ARGUMENT',
      );
    validate(flow, file);
    let values: Record<string, string>;
    try {
      values = valuesFor(flow, o.params ?? {}, process.env, from);
    } catch (e) {
      throw new ToolError(`${file}: ${(e as Error).message}`, 'INVALID_ARGUMENT');
    }
    if (flow.app) {
      s.select(checkApp(ctx.policy, fillApp(flow.app, values)));
      s.forgetProcess();
    }
    const undo = ctx.hide(flow.secrets.flatMap((n) => values[n] ?? []));
    const was: Was = {
      app: undefined,
      up: false,
      pid: undefined,
      since: Date.now(),
      began: Date.now(),
    };
    try {
      const result = await runSteps(flow, executor(s, was), {
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
          f.screen = header(screen);
        }
        const appDied =
          f.code === 'APP_NOT_RUNNING'
            ? undefined
            : await diedUnder(s, was.app, screen?.foreground, was.pid, was.since, clean, was.up);
        if (appDied)
          Object.assign(f, {
            message: `${f.message}\n${diedLine(appDied)}, by step ${f.n}`,
            code: 'APP_NOT_RUNNING',
            hint: DIED_HINT,
          });
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
      `${f.file ?? file}:${f.line}: step ${f.n} failed: ${f.step}`,
      f.message,
      ...(f.screen ? [f.screen] : []),
      `to go on from here: appdyno flow run ${file} --from ${f.n}`,
    ].join('\n');

  return { run, lineOf, failureText };
}

export type FlowRunner = ReturnType<typeof flowRunner>;
