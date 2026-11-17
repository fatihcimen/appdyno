import { must } from '@appdyno/core';
import {
  fillStep,
  givesOf,
  namesOf,
  runsOn,
  stepLine,
  stepsInOrder,
  type Flow,
  type FlowStep,
} from './format.js';

/** What a step's action did. */
export type StepOutcome = {
  /** From the action to the settled screen, as the device timed it (or the whole step where nothing else can). */
  settledMs?: number;
  /** The action alone, on this machine's clock: no lookup and no hook around it. */
  actMs?: number;
  settled?: boolean;
  changed?: boolean;
  warnings?: string[];
  /** Values a `prepare` step gave, by name: the steps after it take them. */
  values?: Record<string, string>;
};

/** Where a step that is not the flow's own runs: before its first, or after its last or its failure. */
export type Phase = 'setup' | 'teardown';

export type StepResult = Omit<StepOutcome, 'values'> & {
  /** 1-based, as `--from` takes it; a setup's and a teardown's steps are counted on their own. */
  n: number;
  line: number;
  /** The file of `line`, when another flow ran this one. */
  file?: string;
  phase?: Phase;
  /** The line of the file, with its placeholders: never a value. */
  step: string;
  /** All of the step, its lookup included. */
  ms: number;
  /** Why it did not run, where it is another platform's: nothing of it reached the device. */
  skipped?: string;
};

export type StepEvent =
  | { phase: 'before'; n: number; total: number; step: FlowStep }
  | { phase: 'after'; n: number; total: number; step: FlowStep; result: StepResult };

export type RunFailure = {
  n: number;
  line: number;
  file?: string;
  /** A failure of the setup or of a teardown step; none: of the flow's own steps. */
  phase?: Phase;
  step: string;
  message: string;
  code?: string;
  hint?: string;
  /** The screen at the failure, as text, its secrets hidden. */
  screen?: string;
  /** The files it left. */
  saved?: string[];
};

export type RunResult = {
  /** The setup and the flow's own steps ran to their end: a teardown's failure is told apart, in `teardown`. */
  passed: boolean;
  /** The flow's own steps that ran to their end. */
  steps: StepResult[];
  /** The setup's. */
  setup?: StepResult[];
  /** The first failure of the setup or of the flow's own steps, which ended them. */
  failure?: RunFailure;
  /** What the teardown did: every step of it ran, and each that failed is kept. */
  teardown?: { ok: boolean; steps: StepResult[]; failed: RunFailure[] };
};

export type RunOptions = {
  /** The step to begin at, 1-based: the setup runs all the same. */
  from?: number;
  /** Values of the flow's names. */
  values?: Record<string, string>;
  /**
   * Around each of the flow's own steps' action, awaited: `before` when its target is on the screen and nothing of the
   * action has happened, `after` when the screen settled. What a measure of each step hangs on, so a setup and a
   * teardown are in no measure. A hook that throws ends the run with its error.
   */
  onStep?: (e: StepEvent) => void | Promise<void>;
  /** Called before each step but a teardown's (a cancelled call stops here). */
  checkpoint?: (n: number, total: number, step: FlowStep) => void;
  /**
   * Called as each step's action begins and once it ran to its end, a setup's and a teardown's too: what a caller counts
   * to know whether a run it stopped had touched the device.
   */
  progress?: (at: 'before' | 'after') => void;
  /** At the failure that ends the steps, awaited before the teardown changes the screen it left. */
  onFailure?: (failure: RunFailure) => void | Promise<void>;
  /** The device's platform: a step kept to the other one is skipped, and its result says so. */
  platform?: string;
};

/** How a device carries out a step: `prepare` waits for its target, `act` does it. */
export type Executor = {
  prepare?: (step: FlowStep) => Promise<void>;
  act: (step: FlowStep) => Promise<StepOutcome>;
};

/**
 * Runs a flow's steps in order with no model in the loop. The first failure ends them, saying which step
 * and line: nothing is retried, skipped or guessed. A teardown runs after them whether they failed or not, every
 * step of it, as each cleans up one thing.
 */
export async function runSteps(
  flow: Flow,
  exec: Executor,
  {
    from = 1,
    values: given = {},
    onStep,
    checkpoint,
    onFailure,
    platform,
    progress,
  }: RunOptions = {},
): Promise<RunResult> {
  // a prepare step's values join them, for this run alone
  const values = { ...given };
  /** The names a `prepare` step is to give: one that did not is no value, where the run was given none. */
  const owed = new Set(stepsInOrder(flow, 1, platform).flatMap(givesOf));
  const one = async (
    list: FlowStep[],
    n: number,
    phase?: Phase,
  ): Promise<{ result: StepResult } | { failure: RunFailure }> => {
    const total = list.length;
    const written = must(list[n - 1], `step ${n}`);
    const at = {
      n,
      line: written.line,
      ...(written.file && { file: written.file }),
      ...(phase && { phase }),
      step: stepLine(written),
    };
    if (!runsOn(written, platform))
      return { result: { ...at, ms: 0, skipped: `${String(written.only)} only` } };
    const hook = phase ? undefined : onStep;
    if (phase !== 'teardown') checkpoint?.(n, total, written);
    const t0 = Date.now();
    let result: StepResult;
    try {
      // typed as it is written, a name would reach the app as `${NAME}`
      const unfilled = namesOf(written).filter(
        (name) => owed.has(name) && values[name] === undefined,
      );
      if (unfilled.length > 0)
        throw new Error(
          `no value for ${unfilled.join(', ')}: the step that gives it did not run to its end`,
        );
      const step = fillStep(written, values);
      await exec.prepare?.(step);
      await hook?.({ phase: 'before', n, total, step: written });
      progress?.('before');
      const { values: gave, ...outcome } = await exec.act(step);
      Object.assign(values, gave);
      result = { ...at, ms: Date.now() - t0, ...outcome };
      progress?.('after');
    } catch (e) {
      const err = e as Error & { code?: string; hint?: string };
      return {
        failure: {
          ...at,
          message: err.message,
          ...(err.code && { code: err.code }),
          ...(err.hint && { hint: err.hint }),
        },
      };
    }
    await hook?.({ phase: 'after', n, total, step: written, result });
    return { result };
  };
  /** A list's steps until one fails, the ones that ran to their end in `into`. */
  const through = async (list: FlowStep[], first: number, into: StepResult[], phase?: Phase) => {
    for (let n = first; n <= list.length; n++) {
      const ran = await one(list, n, phase);
      if ('failure' in ran) return ran.failure;
      into.push(ran.result);
    }
    return undefined;
  };
  const setup: StepResult[] = [];
  const steps: StepResult[] = [];
  const failure =
    (await through(flow.setup ?? [], 1, setup, 'setup')) ??
    (await through(flow.steps, from, steps));
  if (failure) await onFailure?.(failure);
  const cleaned: StepResult[] = [];
  const failed: RunFailure[] = [];
  const teardown = flow.teardown ?? [];
  for (let n = 1; n <= teardown.length; n++) {
    const ran = await one(teardown, n, 'teardown');
    if ('failure' in ran) failed.push(ran.failure);
    else cleaned.push(ran.result);
  }
  return {
    passed: !failure,
    steps,
    ...(flow.setup && { setup }),
    ...(failure && { failure }),
    ...(flow.teardown && { teardown: { ok: failed.length === 0, steps: cleaned, failed } }),
  };
}
