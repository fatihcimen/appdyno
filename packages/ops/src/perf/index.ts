import type { ServerContext } from '../context.js';
import type { FlowRunner } from '../flow/runner.js';
import { perfSnapshotOp } from './snapshot.js';
import { perfScrollOp } from './scroll.js';
import { perfLaunchOp } from './launch.js';
import { perfProfileOp } from './profile.js';
import { perfHeapOp } from './heap.js';
import { perfTraceOp } from './trace.js';
import { perfCompareOp } from './compare.js';
import { perfQueryOp } from './query.js';

export function perfOps(ctx: ServerContext, runner: FlowRunner) {
  return [
    perfSnapshotOp(ctx),
    perfScrollOp(ctx),
    perfLaunchOp(ctx),
    perfProfileOp(ctx),
    perfHeapOp(ctx),
    perfTraceOp(ctx),
    perfCompareOp(ctx, runner),
    perfQueryOp(ctx),
  ];
}
