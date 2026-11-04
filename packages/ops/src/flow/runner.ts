import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nearest, throwIfCancelled, reportProgress } from '@appdyno/core';
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
import type { ServerContext } from '../context.js';
import { checkApp } from '../policy.js';
import type { ActionOut } from '../schemas.js';
import type { Session } from '../session.js';
import type { Steps } from '../steps.js';
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
        'UNSUPPORTED',
      );
  }
}

/** They end on a settled screen with no time from the device (no lookup before, or several actions): all of the step is the time. */
const WHOLE_STEP = new Set(['launch', 'open_link', 'scroll_to']);

const READS_ONLY = new Set(['wait_for', 'assert']);

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
    const p = ops()[name]!.input.safeParse(args);
    if (!p.success)
      throw new ToolError(`${where}: ${z.prettifyError(p.error)}`, 'INVALID_ARGUMENT');
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

  const prepare = async (s: Session, st: FlowStep) => {
    if (st.args.screen) {
      const w = await steps.windowSize(s);
      if (st.args.screen !== `${w.w}x${w.h}`)
        throw new ToolError(
          `this step is for a ${String(st.args.screen)} screen and this one is ${w.w}x${w.h}: name its target in the flow`,
          'INVALID_ARGUMENT',
        );
    }
    if (!st.selector || READS_ONLY.has(st.action) || st.action === 'scroll_to') return;
    // no error here: if it never comes, the op itself refuses, with the nearest candidates
    await steps.waitFor(s, { ...st.selector, gone: false, timeoutMs: REPLAY_WAIT_MS });
    await steps.holdsStill(s, st.selector);
  };

  const act = async (s: Session, st: FlowStep): Promise<StepOutcome> => {
    const [name, args] = opCall(st);
    const t0 = Date.now();
    const answered = await ops()[name]!.handler(opInput(name, args, st.action));
    const data = answered.data as Partial<ActionOut> & { met?: boolean };
    const whole = Date.now() - t0;
    if (data.met === false) {
      const screen = await s.read();
      const near = nearest(screen.list, st.selector?.text ?? st.selector?.id).map(steps.line);
      throw new ToolError(
        `${st.args.gone ? 'still there' : 'not shown'} after ${String(st.args.timeoutMs ?? REPLAY_WAIT_MS)} ms${near.length > 0 ? `; nearest: ${near.join('; ')}` : ''}`,
        'TIMEOUT',
      );
    }
    const died = data.appDied;
    if (died)
      throw new ToolError(
        `the app died: ${died.reason}${died.file ? ` (${died.file})` : ''}`,
        'APP_NOT_RUNNING',
      );
    const settledMs = WHOLE_STEP.has(st.action)
      ? whole
      : READS_ONLY.has(st.action)
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

  // the run's failure is read from what these throw, and a replay from code has no op around it
  const executor = (s: Session): Executor => ({
    prepare: (st) => prepare(s, st).catch(refused),
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
