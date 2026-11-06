import { mkdir } from 'node:fs/promises';
import type { HeapReading } from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { HeapOut } from './schemas.js';
import { defineOp, READ, reply } from '../tool.js';
import { keepRefusal, perfTools, App } from './shared.js';

const HEAP: Record<HeapReading['kind'], { store: string; label: string }> = {
  hprof: { store: 'heap-dump', label: 'heap dump' },
  memgraph: { store: 'heap-graph', label: 'memory graph (Xcode)' },
  trace: { store: 'heap-leaks', label: 'Leaks trace (Instruments)' },
};

export function perfHeapOp(ctx: ServerContext) {
  const { measure, appOf, save, keep } = perfTools(ctx);
  return defineOp({
    name: 'perf_heap',
    title: 'Heap dump',
    description:
      "Heap dump, memory leaks: the app's heap into a local file (Android: Java HPROF; iOS simulator: an Xcode memory graph; iPhone, signed for development: a Leaks trace; on iOS the leak count). Android `profile`: a Perfetto trace, top classes or sites, on a debuggable or profileable build.",
    input: z
      .object({
        app: App,
        profile: z.enum(['java_hprof', 'heapprofd']).optional(),
        seconds: z.number().int().min(1).max(60).default(5),
      })
      .strict(),
    output: HeapOut,
    annotations: READ,
    run: async ({ app, profile, seconds }) => {
      const s = await ctx.session();
      s.appPid = undefined;
      const pkg = appOf(s, app);
      if (profile) {
        const m = await measure(s, 'heapProfile')(pkg, profile, seconds);
        const v = m.value;
        const saved = await save('heap-profile', [m], v);
        await keep(s, {
          app: pkg,
          scenario: `heap-${profile}`,
          source: 'perf_heap',
          raw: saved.txt,
          metrics: [{ kind: 'heap.bytes', unit: 'bytes', samples: [v.totalBytes] }],
        });
        return reply(
          [
            `measurement ${saved.id}`,
            `${profile}: ${v.totalBytes} bytes`,
            ...v.top.slice(0, 10).map((e) => `${e.bytes} bytes, ${e.count}× ${e.name}`),
            `trace (perf_query): ${v.tracePath}`,
          ].join('\n'),
          { id: saved.id, file: v.tracePath, bytes: v.totalBytes, top: v.top.slice(0, 20) },
        );
      }
      const dump = measure(s, 'heap');
      await mkdir(ctx.measurementsDir, { recursive: true });
      const m = await dump(pkg, ctx.measurementsDir);
      const v = m.value;
      const saved = await save(HEAP[v.kind].store, [m], v);
      if (v.leaks !== undefined)
        await keep(s, {
          app: pkg,
          scenario: 'heap',
          source: 'perf_heap',
          raw: saved.txt,
          metrics: [{ kind: 'heap.leaks', unit: 'count', samples: [v.leaks] }],
        });
      else
        await keepRefusal(
          ctx,
          s,
          pkg,
          'leaks',
          "a heap dump has no count of leaks: read it in a memory analyser, or watch Activities rise in perf_scroll's rounds",
        );
      return reply(
        `measurement ${saved.id}\n${HEAP[v.kind].label}: ${v.file} (${(v.bytes / 1048576).toFixed(1)} MB)${v.leaks !== undefined ? `; ${v.leaks} leaks, ${v.leakedBytes} bytes` : ''}${v.note ? `\n${v.note}` : ''}`,
        {
          id: saved.id,
          file: v.file,
          bytes: v.bytes,
          ...(v.leaks !== undefined && { leaks: v.leaks }),
        },
      );
    },
  });
}
