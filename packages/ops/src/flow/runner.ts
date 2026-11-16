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
import { asStepBegan, diedHint, diedLine, diedUnder } from '../app-death.js';
import type { ServerContext } from '../context.js';
import { checkApp } from '../policy.js';
import { LOOKS_ONLY } from '../step-schemas.js';
import type { ActionOut } from '../schemas.js';
import type { Session } from '../session.js';
import type { Steps } from '../steps.js';
import { keyboardFirst } from '../keyboard.js';
import { refused, ToolError, type Op } from '../tool.js';
import { WHOLE_STEP } from '../tool-kinds.js';
import { dropRules } from '../network-capture.js';
import { mockLine, opCall, REPLAY_WAIT_MS, SHOTS_DIR, type StepPlace } from './op-call.js';
import { loadRecording } from './shared.js';
import { looksStill } from './still.js';

/** What a step took: the device's own count from action to settled where it has one, else the action on this Mac's clock. */
export const stepTime = (action: FlowStep['action'], r: StepResult) =>
  !WHOLE_STEP.has(action) && r.settledMs !== undefined
    ? { ms: r.settledMs, throughHost: false }
    : { ms: r.actMs ?? r.ms, throughHost: true };

export type ReplayOptions = Pick<RunOptions, 'from' | 'onStep'> & {
  params?: Record<string, string>;
  /** An env file's values: under `params`, over the context's environment, and hidden as a secret is once used. */
  fromFile?: Record<string, string>;
  /** Where a failure leaves its screenshot and tree. */
  evidence?: string;
  /** Where a `screenshot` step saves: ./appdyno-screenshots unless a test run keeps its own. */
  shots?: string;
};

/** The values a run took from an env file, the empty ones aside: what a param gave is not the file's. */
const filedValues = (values: Record<string, string>, o: ReplayOptions) =>
  Object.keys(values).flatMap((name) => {
    const v = o.params?.[name] === undefined ? o.fromFile?.[name] : undefined;
    return v ? [v] : [];
  });

/** The failure's moment on disk; what cannot be had is left out, the failure already says enough. */
const keepEvidence = async (s: Session, dir: string, clean: (s: string) => string) => {
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

const lineOf = (r: RunResult['steps'][number]) =>
  `${r.n}. ${r.step}: ${r.settledMs !== undefined ? `settled in ${r.settledMs} ms` : `${r.ms} ms`}${r.settled === false ? ' (the screen may still be changing)' : ''}`;

const failureText = (file: string, f: RunFailure) =>
  [
    `${f.file ?? file}:${f.line}: step ${f.n} failed: ${f.step}`,
    f.message,
    ...(f.screen ? [f.screen] : []),
    `to go on from here: appdyno flow run ${file} --from ${f.n}`,
  ].join('\n');

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

  /**
   * Every step's arguments, before the first runs: a typo is not found at step 40. And no baseline is saved after a
   * step that acts on a target picked by its index: on this run that may be another element, and a baseline of the
   * screen it led to would pass ever after, where a comparison would have failed.
   */
  const validate = (flow: Flow, at: StepPlace) => {
    let picked: FlowStep | undefined;
    for (const st of flow.steps) {
      if (st.action === 'unrecorded') continue;
      const where = `${st.file ?? at.file}:${st.line}`;
      if (at.update && st.action === 'visual' && picked)
        throw new ToolError(
          `${where}: no baseline is saved after ${picked.file ?? at.file}:${picked.line}, whose target is picked by its index among several (!ambiguous): it may be another element on this run`,
          'INVALID_ARGUMENT',
          'name that target by a selector that finds it alone, and take !ambiguous off its line',
        );
      // a check of another element fails or passes, and leads to no other screen
      if (st.flags.includes('ambiguous') && !LOOKS_ONLY.has(st.action)) picked ??= st;
      const [name, args] = opCall(st, at);
      opInput(name, args, where);
    }
  };

  const prepare = async (s: Session, st: FlowStep) => {
    // the visual tool waits for a still screen itself
    if (st.action === 'screenshot') await looksStill(s);
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
    await steps.waitFor(s, { selector: st.selector, gone: false, timeoutMs: REPLAY_WAIT_MS });
    await steps.holdsStill(s, st.selector);
  };

  const act = async (s: Session, st: FlowStep, at: StepPlace): Promise<StepOutcome> => {
    const [name, args] = opCall(st, at);
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
    if (st.action === 'mock') at.mocked.push(mockLine(st, at));
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
  const executor = (s: Session, was: Was, at: StepPlace): Executor => ({
    prepare: (st) => {
      Object.assign(was, {
        ...asStepBegan(s, s.fresh?.foreground),
        since: was.began,
        began: Date.now(),
      });
      return prepare(s, st).catch(refused);
    },
    act: (st) => act(s, st, at).catch(refused),
  });

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
    const at = {
      file,
      shots: o.shots ?? SHOTS_DIR,
      update: ctx.options.updateBaselines === true,
      mocked: [],
    };
    validate(flow, at);
    let values: Record<string, string>;
    try {
      values = valuesFor(flow, o.params ?? {}, { ...ctx.options.env, ...o.fromFile }, from);
    } catch (e) {
      throw new ToolError(`${file}: ${(e as Error).message}`, 'INVALID_ARGUMENT');
    }
    // for good, not for this run: the screen it typed a value on is read after it
    ctx.hide(filedValues(values, o));
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
      const result = await runSteps(flow, executor(s, was, at), {
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
            hint: diedHint(appDied),
          });
        if (o.evidence) f.saved = await keepEvidence(s, o.evidence, clean);
      }
      return result;
    } finally {
      undo();
      // the rules its mock steps added, on a pass and on a failure alike: one a person or an agent set stays
      dropRules(s, at.mocked);
    }
  };

  return { run, lineOf, failureText };
}

export type FlowRunner = ReturnType<typeof flowRunner>;
