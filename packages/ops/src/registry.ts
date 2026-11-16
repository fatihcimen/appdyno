import { AsyncLocalStorage } from 'node:async_hooks';
import { callSignal, reportProgress, type DeviceQueue } from '@appdyno/core';
import type { z } from 'zod';
import { activityFor } from './activity.js';
import { answersFor, type Answers } from './answers.js';
import { catalogOf, piecesOf } from './catalog.js';
import type { ServerContext } from './context.js';
import { flowRecorder } from './flow/recorder.js';
import { flowRunner, type FlowRunner, type ReplayOptions } from './flow/runner.js';
import { readFlow } from './flow/shared.js';
import { runTests, type TestOptions } from './flow/test-run.js';
import { reportFor } from './report.js';
import { stepsFor, type Steps } from './steps.js';
import { KIND_NAMES } from './tool-kinds.js';
import { givenUp, onlyReads, refused, type Op } from './tool.js';

const everyOp = (
  ctx: ServerContext,
  answers: Answers,
  steps: Steps,
  report: ReturnType<typeof reportFor>,
  runner: FlowRunner,
  tools: () => Record<string, Op>,
) => catalogOf(piecesOf(ctx, answers, steps, report, runner, tools));

/** The queue a call that acts holds: what it calls in turn, a step's op, runs within it, not after it. */
const holding = new AsyncLocalStorage<DeviceQueue>();

/**
 * An op that acts waits for the one before it: a tap sent with another aimed at the screen before the first, and landed
 * where its ref had been on the screen the first opened. One that only reads runs beside them.
 */
const inTurn = (queue: DeviceQueue, op: Op): Op =>
  onlyReads(op)
    ? op
    : {
        ...op,
        handler: (args) => {
          if (holding.getStore() === queue || op.readsOnly?.(args)) return op.handler(args);
          if (queue.busy)
            reportProgress('waiting its turn: an action this client sent before it still runs');
          return queue
            .run(() => {
              // a call its client gave up while it waited does nothing
              if (callSignal()?.aborted) throw givenUp(op.name);
              return holding.run(queue, () => op.handler(args));
            })
            .catch(refused);
        },
      };

function build(ctx: ServerContext) {
  const answers = answersFor(ctx);
  const recorder = flowRecorder(ctx);
  const steps = stepsFor(ctx, answers, recorder.through);
  let raw: Record<string, Op> = {};
  let ops: Record<string, Op> = {};
  const runner = flowRunner(ctx, () => raw, answers, steps);
  const report = reportFor(ctx);
  const activity = activityFor(ctx);
  raw = Object.fromEntries(
    everyOp(ctx, answers, steps, report, runner, () => ops).map((op) => [
      op.name,
      report.wrap(activity(op)),
    ]),
  );
  ops = Object.fromEntries(
    Object.values(raw).map((op) => [op.name, inTurn(ctx.acting, recorder.wrap(op))]),
  );
  return { ops, runner };
}

type AnyOp = ReturnType<typeof everyOp>[number];

export type OpName = AnyOp['name'];

/** A name of `tool-kinds.ts` that is no tool fails the build here, where the tools are known. */
const _kinds: readonly OpName[] = KIND_NAMES;

/** What this op answers, as its output schema says: of a tool of several parts, what one of them does. */
export type OpData<N extends OpName> = z.infer<Extract<AnyOp, { name: N }>['output']>;

type Keys<U> = U extends unknown ? keyof U : never;

/**
 * That answer read as one: every field any of its parts answers, for a caller that knows which part it called and
 * reads that part's fields without saying so to the compiler.
 */
export type OpFields<N extends OpName, U = OpData<N>> = {
  [K in Keys<U>]: U extends unknown ? (K extends keyof U ? U[K] : never) : never;
};

/** Every operation over this context, by name: what the MCP tools and CLI commands are made from. */
export const opsFor = (ctx: ServerContext): Record<string, Op> => build(ctx).ops;

/** Flows run from code: a file on the context's device (with per-step hooks), or a test run. */
export function flowsFor(ctx: ServerContext) {
  const { runner } = build(ctx);
  return {
    replay: async (file: string, o?: ReplayOptions) =>
      runner.run(await ctx.session(), readFlow(file), file, o),
    test: (o: TestOptions) => runTests(ctx, runner, o),
  };
}
