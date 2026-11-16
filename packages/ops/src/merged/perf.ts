import { z } from 'zod';
import type { Pieces } from '../catalog.js';
import { mergeOp } from '../merge.js';
import { DESTRUCTIVE } from '../tool.js';

export const measurePerformance = (
  p: Pick<
    Pieces,
    'perf_snapshot' | 'perf_launch' | 'perf_scroll' | 'perf_trace' | 'perf_profile' | 'perf_heap'
  >,
) => {
  const by = {
    snapshot: p.perf_snapshot,
    launch: p.perf_launch,
    scroll: p.perf_scroll,
    frames: p.perf_trace,
    cpu: p.perf_profile,
    heap: p.perf_heap,
  };
  return mergeOp({
    name: 'measure_performance',
    title: 'Measure performance',
    description:
      "Measure performance by metric. launch: startup time, cold, warm or hot, over repeats; trace: why. scroll: jank and frozen frames of a list (x,y or selector). heap: memory leaks, the heap to a file. frames: why frames were slow, hitches, hangs (what). cpu: top functions over seconds. snapshot: CPU, memory, frames, load and heat now (also). Returns numbers, findings, a trace's path; scenario keeps the run for compare_performance.",
    input: z
      .object({
        metric: z.enum(['snapshot', 'launch', 'scroll', 'frames', 'cpu', 'heap']),
        ...by.snapshot.input.shape,
        ...by.launch.input.shape,
        ...by.scroll.input.shape,
        ...by.frames.input.omit({ scroll: true }).shape,
        ...by.heap.input.shape,
        // what several metrics take, each with a limit and a default of its own, is each one's to hold
        repeats: z.number().int().optional(),
        seconds: z.number().optional(),
        direction: z.enum(['up', 'down']).optional().describe('frames, cpu: scroll meanwhile'),
      })
      .strict(),
    // the worst of its metrics: a launch stops the app and starts it
    annotations: DESTRUCTIVE,
    parts: [by.snapshot, by.launch, by.scroll, by.frames, by.cpu, by.heap],
    pick: ({ metric, direction, ...a }) =>
      metric === 'frames' || metric === 'cpu'
        ? [by[metric], { ...a, scroll: direction }, { scroll: 'direction' }]
        : [by[metric], { ...a, direction }],
  });
};

export const comparePerformance = ({
  perf_compare: gate,
  perf_query: query,
}: Pick<Pieces, 'perf_compare' | 'perf_query'>) =>
  mergeOp({
    name: 'compare_performance',
    title: 'Performance baseline and gate',
    description:
      "Performance regression gate over kept runs; measuring: measure_performance. compare: the last newest runs against baseline and budgets in .appdyno/perf/; a change must be statistically and practically significant. why: a regression's cause on device; reference: its other side. baseline: adds the last runs (3 needed), replace resets. budget: kind, max or min. functions: two cpu ids. query: a bounded table of a kept trace (Perfetto: read-only sql; Instruments: table). prune: traces. Returns the verdict.",
    input: z
      .object({
        ...gate.input.shape,
        action: z.enum([...gate.input.shape.action.unwrap().options, 'query']).default('compare'),
        ...query.input.shape,
        trace: query.input.shape.trace.optional(),
      })
      .strict(),
    // the worst of its actions: `why` and `reference` replay a flow and restart the app
    annotations: DESTRUCTIVE,
    parts: [gate, query],
    pick: ({ action, ...a }) => (action === 'query' ? [query, a] : [gate, { ...a, action }]),
  });
