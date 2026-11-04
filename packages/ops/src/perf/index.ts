import type { ServerContext } from '../context.js';
import { perfSnapshotOp } from './snapshot.js';
import { perfScrollOp } from './scroll.js';
import { perfLaunchOp } from './launch.js';
import { perfProfileOp } from './profile.js';
import { perfHeapOp } from './heap.js';
import { perfTraceOp } from './trace.js';
import { perfCompareOp } from './compare.js';
import { perfQueryOp } from './query.js';

export function perfOps(ctx: ServerContext) {
  return [
    perfSnapshotOp(ctx),
    perfScrollOp(ctx),
    perfLaunchOp(ctx),
    perfProfileOp(ctx),
    perfHeapOp(ctx),
    perfTraceOp(ctx),
    perfCompareOp(ctx),
    perfQueryOp(ctx),
  ];
}
