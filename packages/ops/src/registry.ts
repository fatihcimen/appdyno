import { actOps } from './act.js';
import { answersFor } from './answers.js';
import { appOps } from './apps.js';
import type { ServerContext } from './context.js';
import { deviceOps } from './device.js';
import { perfOps } from './perf.js';
import { readOps } from './read.js';
import { stepsFor } from './steps.js';
import type { Op } from './tool.js';

/** Every operation over this context, by name: what the MCP tools and CLI commands are made from. */
export function opsFor(ctx: ServerContext): Record<string, Op> {
  const answers = answersFor(ctx);
  const steps = stepsFor(ctx, answers);
  const ops = [
    ...deviceOps(ctx, answers),
    ...readOps(ctx, answers),
    ...actOps(ctx, answers, steps),
    ...appOps(ctx, answers),
    ...perfOps(ctx),
  ];
  return Object.fromEntries(ops.map((op) => [op.name, op]));
}
