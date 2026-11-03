import { actOps } from './act.js';
import { answersFor } from './answers.js';
import { appOps } from './apps.js';
import type { ServerContext } from './context.js';
import { controlOps } from './control.js';
import { deviceOps } from './device.js';
import { diagnoseOps } from './diagnose.js';
import {
  flowOps,
  flowRecorder,
  flowRunner,
  readFlow,
  runTests,
  type ReplayOptions,
  type TestOptions,
} from './flow.js';
import { networkOps } from './network.js';
import { perfOps } from './perf.js';
import { readOps } from './read.js';
import { recordOps } from './record.js';
import { reportFor } from './report.js';
import { stepsFor } from './steps.js';
import type { Op } from './tool.js';

function build(ctx: ServerContext) {
  const answers = answersFor(ctx);
  const recorder = flowRecorder(ctx);
  const steps = stepsFor(ctx, answers, recorder.through);
  let raw: Record<string, Op> = {};
  const runner = flowRunner(ctx, () => raw, answers, steps);
  const report = reportFor(ctx);
  raw = Object.fromEntries(
    [
      ...deviceOps(ctx, answers),
      ...readOps(ctx, answers, steps),
      ...actOps(ctx, answers, steps),
      ...appOps(ctx, answers),
      ...controlOps(ctx, answers),
      ...diagnoseOps(ctx, answers),
      ...recordOps(ctx),
      ...report.ops(),
      ...networkOps(ctx),
      ...perfOps(ctx),
      ...flowOps(ctx, runner),
    ].map((op) => [op.name, report.wrap(op)]),
  );
  const ops = Object.fromEntries(Object.values(raw).map((op) => [op.name, recorder.wrap(op)]));
  return { ops, runner };
}

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
