import { store } from '@appdyno/perf';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { refused } from '../session.js';
import { TraceOut } from '../schemas.js';
import { type Op, defineOp, ACT, reply } from '../tool.js';
import { perfTools, App, Probe, Scenario, measure, virtual } from './shared.js';

export function perfTraceOp(ctx: ServerContext): Op {
  const { appOf, virtualNote, save, keep, noisy, withProbe, scroller } = perfTools(ctx);
  return defineOp({
    name: 'perf_trace',
    title: 'Frame trace',
    description:
      "Record frames (Android 12+: each frame's time and why it was late; iPhone: animation hitches, their ratio and causes; iOS simulator with `probe`: main-thread pacing). `scroll` scrolls meanwhile. `what`: hangs (iPhone), or XCTest's own hitch or launch metric. The trace is kept for perf_query.",
    input: z
      .object({
        app: App,
        seconds: z.number().min(1).max(30).default(5),
        scroll: z.enum(['up', 'down']).optional(),
        what: z.enum(['frames', 'hangs', 'xct_hitches', 'xct_launch']).default('frames'),
        probe: Probe,
        scenario: Scenario,
      })
      .strict(),
    output: TraceOut,
    annotations: ACT,
    needs: 'frameTrace',
    run: async ({ app, seconds, scroll, what, probe, scenario }) => {
      const s = await ctx.session();
      s.appPid = undefined;
      const pkg = appOf(s, app);
      const name = scenario ?? (what === 'frames' ? 'trace' : what);
      if (what === 'xct_hitches' || what === 'xct_launch') {
        const test = what === 'xct_hitches' ? 'hitches' : 'launch';
        const m = await measure(s, 'xctMetrics')(pkg, test).catch(refused);
        const saved = await save(what, [m], m.value);
        const noise = await keep(
          s,
          pkg,
          name,
          'XCTest measure()',
          saved.txt,
          Object.entries(m.value.metrics).map(([kind, samples]) => ({
            kind: `xct.${kind}`,
            unit: 'ms' as const,
            samples,
          })),
        );
        return reply(
          [
            `measurement ${saved.id}${virtualNote(s)}`,
            ...Object.entries(m.value.metrics).map(([k, xs]) => `${k}: ${xs.join(', ')}`),
            ...(m.value.note ? [m.value.note] : []),
            ...noisy(noise),
            `result bundle: ${m.value.resultBundle}`,
          ].join('\n'),
          {
            id: saved.id,
            raw: saved.txt,
            virtualDevice: virtual(s),
            frames: 0,
            worstMs: 0,
            metrics: m.value.metrics,
            tracePath: m.value.resultBundle,
            noise,
          },
        );
      }
      if (what === 'hangs') {
        const during = scroll ? await scroller(s, scroll, 500) : undefined;
        const v = await measure(s, 'hangs')(pkg, seconds, during).catch(refused);
        if (scroll) s.acted();
        const saved = await store(ctx.measurementsDir, 'hangs', v, v.tracePath);
        const noise = await keep(s, pkg, name, 'xctrace Time Profiler potential-hangs', saved.txt, [
          { kind: 'hangs.count', unit: 'count', samples: [v.hangs] },
          { kind: 'hangs.worst_ms', unit: 'ms', samples: [v.worstMs] },
        ]);
        return reply(
          [
            `measurement ${saved.id}${virtualNote(s)}`,
            `${v.hangs} hangs of the main thread (over 250 ms), ${v.totalMs} ms in all, worst ${v.worstMs} ms`,
            ...noisy(noise),
            `trace (Instruments): ${v.tracePath}`,
          ].join('\n'),
          {
            id: saved.id,
            raw: saved.txt,
            virtualDevice: virtual(s),
            frames: 0,
            hangs: v.hangs,
            worstMs: v.worstMs,
            tracePath: v.tracePath,
            noise,
          },
        );
      }
      const record = measure(s, 'frameTrace');
      await withProbe(s, pkg, probe);
      const during = scroll ? await scroller(s, scroll, 500) : undefined;
      const m = await record(pkg, seconds, during).catch(refused);
      if (scroll) s.acted();
      const v = m.value;
      if (v.kind === 'probe') {
        const saved = await save('frame-probe', [m], v);
        const noise = await keep(s, pkg, name, 'CADisplayLink probe', saved.txt, [
          { kind: 'probe.missed_percent', unit: 'percent', samples: [v.missedPercent] },
          { kind: 'probe.p95_ms', unit: 'ms', samples: [v.p95Ms] },
          { kind: 'probe.stall_worst_ms', unit: 'ms', samples: [v.stalls.worstMs] },
          { kind: 'frames.frozen', unit: 'count', samples: [v.frozen] },
        ]);
        return reply(
          [
            `measurement ${saved.id}${virtualNote(s)}`,
            `${v.frames} frames in ${v.durationMs} ms; ${v.missed} missed (${v.missedPercent}%), ${v.frozen} frozen; interval p50 ${v.p50Ms} ms, p95 ${v.p95Ms} ms, worst ${v.worstMs} ms`,
            `stalls over 100 ms: ${v.stalls.count}, ${v.stalls.totalMs} ms in all, worst ${v.stalls.worstMs} ms`,
            ...(v.lastInputMsAgo !== undefined
              ? [`last touch handled ${v.lastInputMsAgo} ms before the end`]
              : []),
            v.limits,
            ...noisy(noise),
            `probe output: ${v.tracePath}`,
          ].join('\n'),
          {
            id: saved.id,
            raw: saved.txt,
            virtualDevice: virtual(s),
            frames: v.frames,
            p50Ms: v.p50Ms,
            p95Ms: v.p95Ms,
            worstMs: v.worstMs,
            missed: v.missed,
            frozen: v.frozen,
            stalls: v.stalls.count,
            tracePath: v.tracePath,
            limits: v.limits,
            noise,
          },
        );
      }
      if (v.kind === 'hitches') {
        const saved = await save('hitches', [m], v);
        const noise = await keep(s, pkg, name, 'xctrace Animation Hitches', saved.txt, [
          { kind: 'hitches.count', unit: 'count', samples: [v.hitches] },
          { kind: 'hitches.ratio', unit: 'ratio', samples: [v.hitchRatio] },
          { kind: 'hitches.worst_ms', unit: 'ms', samples: [v.worstMs] },
          { kind: 'frames.frozen', unit: 'count', samples: [v.frozen] },
        ]);
        const causes = Object.entries(v.causes)
          .map(([c, k]) => `${k}× ${c}`)
          .join('; ');
        return reply(
          [
            `measurement ${saved.id}${virtualNote(s)}`,
            `${v.frames} frames; ${v.hitches} hitches of the app, ${v.hitchMs} ms in all, worst ${v.worstMs} ms, ${v.frozen} frozen; hitch ratio ${v.hitchRatio} ms/s`,
            ...(causes ? [`likely causes: ${causes}`] : []),
            ...noisy(noise),
            `trace (Instruments): ${v.tracePath}`,
          ].join('\n'),
          {
            id: saved.id,
            raw: saved.txt,
            virtualDevice: virtual(s),
            frames: v.frames,
            hitches: v.hitches,
            hitchMs: v.hitchMs,
            worstMs: v.worstMs,
            frozen: v.frozen,
            hitchRatio: v.hitchRatio,
            tracePath: v.tracePath,
            noise,
          },
        );
      }
      const saved = await save('frame-timeline', [m], v);
      const noise = await keep(s, pkg, name, 'perfetto frame timeline', saved.txt, [
        { kind: 'frames.app_jank_percent', unit: 'percent', samples: [v.appJankPercent] },
        { kind: 'frames.p95_ms', unit: 'ms', samples: [v.p95Ms] },
        { kind: 'frames.frozen', unit: 'count', samples: [v.frozen] },
        // the longest frame of the app's process: what a stall of its main thread becomes
        { kind: 'stalls.worst_ms', unit: 'ms', samples: [v.worstMs] },
        ...(v.stats
          ? [
              {
                kind: 'frames.overrun_p95_ms',
                unit: 'ms' as const,
                samples: [v.stats.overrunP95Ms],
              },
              { kind: 'frames.cpu_p95_ms', unit: 'ms' as const, samples: [v.stats.cpuP95Ms] },
            ]
          : []),
      ]);
      return reply(
        [
          `measurement ${saved.id}${virtualNote(s)}`,
          `${v.frames} frames; late by the app ${v.appDeadlineMissed + (v.appResynced ?? 0)} (${v.appJankPercent}%); any jank ${v.janky} (${v.jankyPercent}%: buffer stuffing ${v.bufferStuffing}, compositor ${v.surfaceFlinger})`,
          ...(virtual(s)
            ? [
                "on a virtual device the compositor's jank is the display's prediction error, not the app's: look at the app's share",
              ]
            : []),
          `frame time p50 ${v.p50Ms} ms, p95 ${v.p95Ms} ms, worst ${v.worstMs} ms; frozen frames: ${v.frozen}`,
          ...(v.stats
            ? [
                `overrun p95 ${v.stats.overrunP95Ms} ms, worst ${v.stats.overrunWorstMs} ms; CPU p95 ${v.stats.cpuP95Ms} ms`,
              ]
            : []),
          ...noisy(noise),
          ...(v.tracePath ? [`trace (perf_query): ${v.tracePath}`] : []),
          `raw output: ${saved.txt}`,
        ].join('\n'),
        {
          id: saved.id,
          raw: saved.txt,
          virtualDevice: virtual(s),
          frames: v.frames,
          frozen: v.frozen,
          appDeadlineMissed: v.appDeadlineMissed,
          appJankPercent: v.appJankPercent,
          jankyPercent: v.jankyPercent,
          p50Ms: v.p50Ms,
          p95Ms: v.p95Ms,
          worstMs: v.worstMs,
          ...(v.tracePath && { tracePath: v.tracePath }),
          noise,
        },
      );
    },
  });
}
