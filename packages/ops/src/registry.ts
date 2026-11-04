import type { z } from 'zod';
import { actOps } from './act.js';
import { answersFor, type Answers } from './answers.js';
import { appOps } from './apps.js';
import type { ServerContext } from './context.js';
import { controlOps } from './control.js';
import { settingOps } from './settings.js';
import { deviceOps } from './device.js';
import { diagnoseOps } from './diagnose.js';
import { flowOps } from './flow/ops.js';
import { flowRecorder } from './flow/recorder.js';
import { flowRunner, type FlowRunner, type ReplayOptions } from './flow/runner.js';
import { readFlow } from './flow/shared.js';
import { runTests, type TestOptions } from './flow/test-run.js';
import { networkOps } from './network.js';
import { perfOps } from './perf/index.js';
import { reactNativeOps } from './reactnative.js';
import { readOps } from './read.js';
import { recordOps } from './record.js';
import { reportFor } from './report.js';
import { stepsFor, type Steps } from './steps.js';
import { visualOps } from './visual.js';
import { webOps } from './web.js';
import type { Op } from './tool.js';

const everyOp = (
  ctx: ServerContext,
  answers: Answers,
  steps: Steps,
  report: ReturnType<typeof reportFor>,
  runner: FlowRunner,
) => [
  ...deviceOps(ctx, answers),
  ...readOps(ctx, answers, steps),
  ...actOps(ctx, answers, steps),
  ...appOps(ctx, answers),
  ...controlOps(ctx, answers),
  ...settingOps(ctx, answers),
  ...diagnoseOps(ctx, answers),
  ...recordOps(ctx),
  ...report.ops(),
  ...networkOps(ctx),
  ...webOps(ctx),
  ...reactNativeOps(ctx),
  ...visualOps(ctx),
  ...perfOps(ctx),
  ...flowOps(ctx, runner),
];

function build(ctx: ServerContext) {
  const answers = answersFor(ctx);
  const recorder = flowRecorder(ctx);
  const steps = stepsFor(ctx, answers, recorder.through);
  let raw: Record<string, Op> = {};
  const runner = flowRunner(ctx, () => raw, answers, steps);
  const report = reportFor(ctx);
  raw = Object.fromEntries(
    everyOp(ctx, answers, steps, report, runner).map((op) => [op.name, report.wrap(op)]),
  );
  const ops = Object.fromEntries(Object.values(raw).map((op) => [op.name, recorder.wrap(op)]));
  return { ops, runner };
}

type AnyOp = ReturnType<typeof everyOp>[number];

export type OpName = AnyOp['name'];

/** What this op answers, as its output schema says. */
export type OpData<N extends OpName> = z.infer<Extract<AnyOp, { name: N }>['output']>;

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
