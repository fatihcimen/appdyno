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
  runsOn,
  stepsInOrder,
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
import { NO_ALERT } from '../act.js';
import { dropRules, heldNow } from '../network-capture.js';
import { requestsFrom } from '../network-check.js';
import { failedSince } from '../network-watch.js';
import { mockLine, opCall, REPLAY_WAIT_MS, SHOTS_DIR, type StepPlace } from './op-call.js';
import { auditWithin, checkedHere, checkHere } from './own-checks.js';
import { prepared, preparedCommand, type PreparePlace } from './prepare.js';
import { cleanupFailure, loadRecording } from './shared.js';
import { looksStill } from './still.js';
import { keepEvidence } from './test-evidence.js';

/** What a step took: the device's own count from action to settled where it has one, else the action on this Mac's clock. */
export const stepTime = (action: FlowStep['action'], r: StepResult) =>
  !WHOLE_STEP.has(action) && r.settledMs !== undefined
    ? { ms: r.settledMs, throughHost: false }
    : { ms: r.actMs ?? r.ms, throughHost: true };

export type ReplayOptions = Pick<RunOptions, 'from' | 'onStep' | 'progress'> & {
  params?: Record<string, string>;
  /** An env file's values: under `params`, over the context's environment, and hidden as a secret is once used. */
  fromFile?: Record<string, string>;
  /** Where a failure leaves its screenshot and tree. */
  evidence?: string;
  /** Where a `screenshot` step saves: ./appdyno-screenshots unless a test run keeps its own. */
  shots?: string;
  /** A person at a terminal started this run: a `prepare` step's command, the project's own, runs with nothing asked. */
  prepares?: boolean;
};

/** The values a run took from an env file, the empty ones aside: what a param gave is not the file's. */
const filedValues = (values: Record<string, string>, o: ReplayOptions) =>
  Object.keys(values).flatMap((name) => {
    const v = o.params?.[name] === undefined ? o.fromFile?.[name] : undefined;
    return v ? [v] : [];
  });

const lineOf = (r: RunResult['steps'][number]) =>
  `${r.phase ? `${r.phase} ` : ''}${r.n}. ${r.step}: ${r.skipped ? `skipped, ${r.skipped}` : r.settledMs !== undefined ? `settled in ${r.settledMs} ms` : `${r.ms} ms`}${r.settled === false ? ' (the screen may still be changing)' : ''}`;

/** A failure's first line: where it is, and of which part of the run. */
const failedAt = (file: string, f: RunFailure) =>
  `${f.file ?? file}:${f.line}: ${f.phase ? `${f.phase} ` : ''}step ${f.n} failed: ${f.step}`;

const failureText = (file: string, f: RunFailure) =>
  [
    failedAt(file, f),
    f.message,
    ...(f.screen ? [f.screen] : []),
    // a setup runs whole on every run: there is no going on from inside it
    ...(f.phase ? [] : [`to go on from here: appdyno run-flow run ${file} --from ${f.n}`]),
  ].join('\n');

/** Every step that ran to its end, in order: the setup's, the flow's own, the teardown's. */
const linesOf = (r: RunResult) =>
  [...(r.setup ?? []), ...r.steps, ...(r.teardown?.steps ?? [])].map(lineOf);

/**
 * A teardown's failures, apart from how the flow's own steps ended: what it was to clean up is still there, so the
 * next run starts from it.
 */
const teardownText = (file: string, r: RunResult) =>
  r.teardown && !r.teardown.ok
    ? [
        'the teardown failed, so what runs next starts from what it left:',
        ...r.teardown.failed.map((f) => `${failedAt(file, f)}\n${f.message}`),
      ].join('\n')
    : undefined;

/** What a `prepare` step needs of its run beside a step's place. */
type Place = StepPlace & PreparePlace & { platform: string };

/** The app as the step began, and when the step before it began: a step that fails as the app is gone failed for its death. */
type Was = ReturnType<typeof asStepBegan> & { since: number; began: number };

/** The failure's own moment, read before a teardown changes the screen it left: its screen, the app's death, the evidence. */
async function seenAsItFailed(
  ctx: ServerContext,
  s: Session,
  f: RunFailure,
  was: Was & { ran: number },
  evidence: string | undefined,
  { header, clean, show }: Answers,
) {
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
  if (evidence) f.saved = await keepEvidence(ctx, s, evidence, { screen, since: was.ran, clean });
}

/** A run's place on this device: refused where no step of the flow is for its platform, as nothing would run. */
function placeOf(
  ctx: ServerContext,
  s: Session,
  flow: Flow,
  file: string,
  o: ReplayOptions,
): Place {
  const { platform } = s.device;
  if (!flow.steps.some((st) => runsOn(st, platform)))
    throw new ToolError(
      `${file}: nothing to run on ${platform}: every step of it is for the other platform alone`,
      'INVALID_ARGUMENT',
    );
  return {
    file,
    shots: o.shots ?? SHOTS_DIR,
    update: ctx.options.updateBaselines === true,
    mocked: [],
    platform,
    prepares: o.prepares === true,
    secrets: flow.secrets,
    kept: new Set(Object.keys(o.params ?? {})),
  };
}

/** Runs flows through the operations themselves, as an agent's calls would. */
export function flowRunner(
  ctx: ServerContext,
  ops: () => Record<string, Op>,
  answers: Answers,
  steps: Steps,
) {
  const { clean } = answers;
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
  const validate = (flow: Flow, at: Place) => {
    let picked: FlowStep | undefined;
    for (const st of stepsInOrder(flow, 1, at.platform)) {
      if (st.action === 'unrecorded' || checkedHere(st)) continue;
      if (st.action === 'prepare') {
        preparedCommand(st, at.file);
        continue;
      }
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

  const act = async (s: Session, st: FlowStep, at: Place): Promise<StepOutcome> => {
    const t0 = Date.now();
    if (st.action === 'prepare') {
      const values = await prepared(ctx, s, st, at, clean);
      return { actMs: Date.now() - t0, values };
    }
    if (checkedHere(st)) {
      await checkHere(s, st, clean, steps.line);
      return { actMs: Date.now() - t0 };
    }
    const [name, args] = opCall(st, at);
    const op = must(ops()[name], `the op ${name}`);
    const answered = await op.handler(opInput(name, args, st.action)).catch(async (e: unknown) => {
      if (!(e instanceof ToolError)) throw e;
      // a prompt comes once: a run after the one that answered it finds none, and that is no failure of the run; a
      // button not on it, or a screen not read, is
      if (st.action === 'alert' && e.code === 'NOT_FOUND' && e.message.startsWith(NO_ALERT))
        return undefined;
      // a wait that ran out fails as a check does, and a flow says it as the time it is
      if (st.action !== 'wait_for' || e.code !== 'CHECK_FAILED') throw e;
      const screen = await s.read();
      const near = nearest(screen.list, st.selector?.text ?? st.selector?.id).map(steps.line);
      throw new ToolError(
        `${st.args.gone ? 'still there' : 'not shown'} after ${String(st.args.timeoutMs ?? REPLAY_WAIT_MS)} ms${near.length > 0 ? `; nearest: ${near.join('; ')}` : ''}`,
        'TIMEOUT',
      );
    });
    const data = (answered?.data ?? {}) as Partial<ActionOut> & { added?: string[] };
    // what a file of answers made is this run's too
    if (st.action === 'mock')
      at.mocked.push(...(st.args.request === undefined ? (data.added ?? []) : [mockLine(st, at)]));
    // a step that only looks has no answer to say it in: a request that failed under it is this step's all the same
    const warnings = [...(data.warnings ?? []), ...(await failedSince(s, t0, '', clean))];
    if (st.action === 'audit' && answered) auditWithin(st, answered);
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
      ...(warnings.length > 0 && { warnings }),
    };
  };

  // the run's failure is read from what these throw, and a replay from code has no op around it
  const executor = (s: Session, was: Was, at: Place): Executor => ({
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
    const at = placeOf(ctx, s, flow, file, o);
    validate(flow, at);
    if (stepsInOrder(flow, 1, at.platform).some((st) => st.action === 'request'))
      at.after = await requestsFrom(s);
    let values: Record<string, string>;
    try {
      const env = { ...ctx.options.env, ...o.fromFile };
      values = valuesFor(flow, o.params ?? {}, env, from, at.platform);
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
    const held = heldNow(s.device.serial);
    const was: Was & { ran: number } = {
      ran: Date.now(),
      app: undefined,
      up: false,
      pid: undefined,
      since: Date.now(),
      began: Date.now(),
    };
    let result: RunResult | undefined;
    try {
      result = await runSteps(flow, executor(s, was, at), {
        from,
        values,
        platform: at.platform,
        onFailure: (f) => seenAsItFailed(ctx, s, f, was, o.evidence, answers),
        ...(o.onStep && { onStep: o.onStep }),
        ...(o.progress && { progress: o.progress }),
        checkpoint: (n, total, st) => {
          throwIfCancelled('run_flow');
          reportProgress(`step ${n} of ${total}: ${st.action}`);
        },
      });
      for (const f of result.teardown?.failed ?? []) f.message = clean(f.message);
      return result;
    } finally {
      undo();
      // the rules its mock steps added, on a pass and on a failure alike: one a person or an agent set stays
      const left = dropRules(s, at.mocked, held);
      if (left && result) result.cleanup = [cleanupFailure('take out its mock rules', clean(left))];
    }
  };

  return { run, linesOf, failureText, teardownText };
}

export type FlowRunner = ReturnType<typeof flowRunner>;
