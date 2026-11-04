import { fillStep, stepLine, type Flow, type FlowStep } from './format.js';

/** What a step's action did. */
export type StepOutcome = {
  /** From the action to the settled screen, as the device timed it (or the whole step where nothing else can). */
  settledMs?: number;
  /** The action alone, on this machine's clock: no lookup and no hook around it. */
  actMs?: number;
  settled?: boolean;
  changed?: boolean;
  warnings?: string[];
};

export type StepResult = StepOutcome & {
  /** 1-based, as `--from` takes it. */
  n: number;
  line: number;
  /** The file of `line`, when another flow ran this one. */
  file?: string;
  /** The line of the file, with its placeholders: never a value. */
  step: string;
  /** All of the step, its lookup included. */
  ms: number;
};

export type StepEvent =
  | { phase: 'before'; n: number; total: number; step: FlowStep }
  | { phase: 'after'; n: number; total: number; step: FlowStep; result: StepResult };

export type RunFailure = {
  n: number;
  line: number;
  file?: string;
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
  passed: boolean;
  /** The steps that ran to their end. */
  steps: StepResult[];
  failure?: RunFailure;
};

export type RunOptions = {
  /** The step to begin at, 1-based. */
  from?: number;
  /** Values of the flow's names. */
  values?: Record<string, string>;
  /**
   * Around each step's action, awaited: `before` when its target is on the screen and nothing of the action
   * has happened, `after` when the screen settled. What a measure of each step hangs on. A hook that
   * throws ends the run with its error.
   */
  onStep?: (e: StepEvent) => void | Promise<void>;
  /** Called before each step (a cancelled call stops here). */
  checkpoint?: (n: number, total: number, step: FlowStep) => void;
};

/** How a device carries out a step: `prepare` waits for its target, `act` does it. */
export type Executor = {
  prepare?: (step: FlowStep) => Promise<void>;
  act: (step: FlowStep) => Promise<StepOutcome>;
};

/**
 * Runs a flow's steps in order with no model in the loop. The first failure ends it, saying which step
 * and line: nothing is retried, skipped or guessed.
 */
export async function runSteps(
  flow: Flow,
  exec: Executor,
  { from = 1, values = {}, onStep, checkpoint }: RunOptions = {},
): Promise<RunResult> {
  const total = flow.steps.length;
  const steps: StepResult[] = [];
  for (let n = from; n <= total; n++) {
    const written = flow.steps[n - 1]!;
    const step = fillStep(written, values);
    const at = {
      n,
      line: written.line,
      ...(written.file && { file: written.file }),
      step: stepLine(written),
    };
    checkpoint?.(n, total, written);
    const t0 = Date.now();
    let outcome: StepOutcome;
    try {
      await exec.prepare?.(step);
      await onStep?.({ phase: 'before', n, total, step: written });
      outcome = await exec.act(step);
    } catch (e) {
      const err = e as Error & { code?: string; hint?: string };
      return {
        passed: false,
        steps,
        failure: {
          ...at,
          message: err.message,
          ...(err.code && { code: err.code }),
          ...(err.hint && { hint: err.hint }),
        },
      };
    }
    const result: StepResult = { ...at, ms: Date.now() - t0, ...outcome };
    steps.push(result);
    await onStep?.({ phase: 'after', n, total, step: written, result });
  }
  return { passed: true, steps };
}
