import {
  frameCauseText,
  hangText,
  MIN_FRAMES,
  type FrameTrace,
  type HangReading,
  type Measured,
  type SlowFrameCauses,
  type XctMetrics,
} from '@appdyno/core';
import { UNEXPLAINED_FRAMES, type Metric } from '@appdyno/perf';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { TraceOut } from './schemas.js';
import { defineOp, ACT, reply } from '../tool.js';
import { perfTools, App, Dsym, Probe, Scenario, symbolsOf } from './shared.js';

/** Why the slow frames were slow, or that the trace cannot say: never a guess. */
const causeLines = (c: SlowFrameCauses | undefined) => {
  if (!c?.slowFrames) return [];
  const [first, ...rest] = c.causes;
  return [
    c.top && first
      ? `why the ${c.slowFrames} slow frames were slow: ${frameCauseText(first)}`
      : `the ${c.slowFrames} slow frames ${UNEXPLAINED_FRAMES}`,
    ...rest.slice(0, 3).map((x) => `then ${frameCauseText(x)}`),
  ];
};

/** A share or a percentile of few frames is a frame or two; a count needs only that there were frames to count. */
const ofMany = (frames: number, x: number) => (frames >= MIN_FRAMES ? [x] : []);
const ofAny = (frames: number, x: number) => (frames > 0 ? [x] : []);
const fewLine = (frames: number) =>
  frames < MIN_FRAMES
    ? [`${frames} frames, of the ${MIN_FRAMES} a share or a percentile needs: none is kept`]
    : [];

/** What a reading says: the kind it is saved as, its numbers, its lines above the noise and below it, and its data. */
type Said = {
  kind: string;
  metrics: Metric[];
  lines: string[];
  after: (raw: string) => string[];
  data: Omit<z.infer<typeof TraceOut>, 'id' | 'raw' | 'virtualDevice' | 'noise'>;
};

/** XCTest's metric under `measure()`, each run's readings. */
function xctSaid(what: 'xct_hitches' | 'xct_launch', m: Measured<XctMetrics>): Said {
  return {
    kind: what,
    metrics: Object.entries(m.value.metrics).map(([kind, samples]) => ({
      kind: `xct.${kind}`,
      unit: 'ms',
      samples,
    })),
    lines: [
      ...Object.entries(m.value.metrics).map(([k, xs]) => `${k}: ${xs.join(', ')}`),
      ...(m.value.note ? [m.value.note] : []),
    ],
    after: () => [`result bundle: ${m.value.resultBundle}`],
    data: {
      metrics: m.value.metrics,
      tracePath: m.value.resultBundle,
    },
  };
}

/** Hangs of the main thread, and what each was. */
function hangsSaid(v: HangReading): Said {
  return {
    kind: 'hangs',
    metrics: [
      { kind: 'hangs.count', unit: 'count', samples: [v.hangs] },
      { kind: 'hangs.worst_ms', unit: 'ms', samples: [v.worstMs] },
    ],
    lines: [
      `${v.hangs} hangs of the main thread (over 250 ms), ${v.totalMs} ms in all, worst ${v.worstMs} ms`,
      ...(v.causes ?? []).map(hangText),
    ],
    after: () => [`trace (Instruments): ${v.tracePath}`],
    data: {
      hangs: v.hangs,
      worstMs: v.worstMs,
      ...(v.causes && { hangCauses: v.causes }),
      tracePath: v.tracePath,
    },
  };
}

/** A simulator app's frames by its probe. */
function probeSaid(v: Extract<FrameTrace, { kind: 'probe' }>): Said {
  return {
    kind: 'frame-probe',
    metrics: [
      {
        kind: 'probe.missed_percent',
        unit: 'percent',
        samples: ofMany(v.frames, v.missedPercent),
      },
      { kind: 'probe.p95_ms', unit: 'ms', samples: ofMany(v.frames, v.p95Ms) },
      {
        kind: 'probe.stall_worst_ms',
        unit: 'ms',
        samples: ofAny(v.frames, v.stalls.worstMs),
      },
      { kind: 'frames.frozen', unit: 'count', samples: ofAny(v.frames, v.frozen) },
    ],
    lines: [
      ...fewLine(v.frames),
      `${v.frames} frames in ${v.durationMs} ms; ${v.missed} missed (${v.missedPercent}%), ${v.frozen} frozen; interval p50 ${v.p50Ms} ms, p95 ${v.p95Ms} ms, worst ${v.worstMs} ms`,
      `stalls over 100 ms: ${v.stalls.count}, ${v.stalls.totalMs} ms in all, worst ${v.stalls.worstMs} ms`,
      ...(v.lastInputMsAgo !== undefined
        ? [`last touch handled ${v.lastInputMsAgo} ms before the end`]
        : []),
      v.limits,
    ],
    after: () => [`probe output: ${v.tracePath}`],
    data: {
      frames: v.frames,
      p50Ms: v.p50Ms,
      p95Ms: v.p95Ms,
      worstMs: v.worstMs,
      missed: v.missed,
      frozen: v.frozen,
      stalls: v.stalls.count,
      tracePath: v.tracePath,
      limits: v.limits,
    },
  };
}

/** A phone's animation hitches, and their likely causes. */
function hitchesSaid(v: Extract<FrameTrace, { kind: 'hitches' }>): Said {
  const causes = Object.entries(v.causes)
    .map(([c, k]) => `${k}× ${c}`)
    .join('; ');
  return {
    kind: 'hitches',
    metrics: [
      { kind: 'hitches.count', unit: 'count', samples: [v.hitches] },
      { kind: 'hitches.ratio', unit: 'ratio', samples: [v.hitchRatio] },
      { kind: 'hitches.worst_ms', unit: 'ms', samples: [v.worstMs] },
      { kind: 'frames.frozen', unit: 'count', samples: [v.frozen] },
      { kind: 'stalls.worst_ms', unit: 'ms', samples: [v.stalls.worstMs] },
    ],
    lines: [
      `${v.frames} frames; ${v.hitches} hitches of the app, ${v.hitchMs} ms in all, worst ${v.worstMs} ms; hitch ratio ${v.hitchRatio} ms/s`,
      `frozen frames: ${v.frozen}; main thread stalled ${v.stalls.count} times, worst ${v.stalls.worstMs} ms`,
      ...(causes ? [`likely causes: ${causes}`] : []),
    ],
    after: () => [`trace (Instruments): ${v.tracePath}`],
    data: {
      frames: v.frames,
      hitches: v.hitches,
      hitchMs: v.hitchMs,
      worstMs: v.worstMs,
      frozen: v.frozen,
      stalls: v.stalls.count,
      hitchRatio: v.hitchRatio,
      tracePath: v.tracePath,
    },
  };
}

/** Android's frame timeline: each frame's time and why it was late. */
function timelineSaid(v: Extract<FrameTrace, { kind: 'timeline' }>, virtual: boolean): Said {
  return {
    kind: 'frame-timeline',
    metrics: [
      {
        kind: 'frames.app_jank_percent',
        unit: 'percent',
        samples: ofMany(v.frames, v.appJankPercent),
      },
      { kind: 'frames.p95_ms', unit: 'ms', samples: ofMany(v.frames, v.p95Ms) },
      { kind: 'frames.frozen', unit: 'count', samples: ofAny(v.frames, v.frozen) },
      // the longest frame of the app's process, or a hold of its main thread no frame shows
      {
        kind: 'stalls.worst_ms',
        unit: 'ms',
        samples:
          v.heldMs === undefined ? ofAny(v.frames, v.worstMs) : [Math.max(v.worstMs, v.heldMs)],
      },
      {
        kind: 'frames.overrun_p95_ms',
        unit: 'ms',
        samples: v.stats ? ofMany(v.frames, v.stats.overrunP95Ms) : [],
      },
      {
        kind: 'frames.cpu_p95_ms',
        unit: 'ms',
        samples: v.stats?.cpuP95Ms === undefined ? [] : ofMany(v.frames, v.stats.cpuP95Ms),
      },
    ],
    lines: [
      ...fewLine(v.frames),
      `${v.frames} frames; late by the app ${v.appDeadlineMissed + (v.appResynced ?? 0)} (${v.appJankPercent}%); any jank ${v.janky} (${v.jankyPercent}%: buffer stuffing ${v.bufferStuffing}, compositor ${v.surfaceFlinger})`,
      ...(virtual
        ? [
            "on a virtual device the compositor's jank is the display's prediction error, not the app's: look at the app's share",
          ]
        : []),
      ...(v.frames > 0
        ? [
            `frame time p50 ${v.p50Ms} ms, p95 ${v.p95Ms} ms, worst ${v.worstMs} ms; frozen frames: ${v.frozen}`,
          ]
        : []),
      ...(v.heldMs !== undefined && v.heldMs > v.worstMs
        ? [
            `its main thread stopped for ${v.heldMs} ms and no frame shows it: from Choreographer's "Skipped frames" line in the app's log`,
          ]
        : []),
      ...(v.stats
        ? [
            `overrun p95 ${v.stats.overrunP95Ms} ms, worst ${v.stats.overrunWorstMs} ms${v.stats.cpuP95Ms === undefined ? '' : `; CPU p95 ${v.stats.cpuP95Ms} ms`}`,
          ]
        : []),
      ...causeLines(v.causes),
    ],
    after: (raw) => [
      ...(v.tracePath ? [`trace (perf_query): ${v.tracePath}`] : []),
      `raw output: ${raw}`,
    ],
    data: {
      frames: v.frames,
      frozen: v.frozen,
      appDeadlineMissed: v.appDeadlineMissed,
      appJankPercent: v.appJankPercent,
      jankyPercent: v.jankyPercent,
      ...(v.causes && {
        slowFrames: v.causes.slowFrames,
        ...(v.causes.top && { slowBecause: v.causes.top }),
      }),
      ...(v.frames > 0 && { p50Ms: v.p50Ms, p95Ms: v.p95Ms, worstMs: v.worstMs }),
      ...(v.heldMs !== undefined && { heldMs: v.heldMs }),
      ...(v.tracePath && { tracePath: v.tracePath }),
    },
  };
}

export function perfTraceOp(ctx: ServerContext) {
  const { measure, measuredApp, virtualNote, save, keep, noisy, withProbe, scroller } =
    perfTools(ctx);
  return defineOp({
    name: 'perf_trace',
    title: 'Frame trace',
    description:
      "Why frames were slow, jank: frames (Android 12+: each frame's time and why it was late; iPhone: animation hitches and causes; iOS simulator: main-thread pacing, by a probe). `what`: hangs (iPhone), or XCTest's hitch or launch metric. Kept for perf_query.",
    input: z
      .object({
        app: App,
        seconds: z.number().min(1).max(30).default(5),
        scroll: z.enum(['up', 'down']).optional(),
        what: z.enum(['frames', 'hangs', 'xct_hitches', 'xct_launch']).default('frames'),
        dsym: Dsym,
        probe: Probe,
        scenario: Scenario,
      })
      .strict(),
    output: TraceOut,
    annotations: ACT,
    // with no swipe and no relaunch it only records, beside the taps that load the app it traces, as perf_profile
    readsOnly: ({ scroll, what, probe }) =>
      !scroll &&
      (what === 'hangs' ||
        (what === 'frames' && !(probe ?? ctx.openSession?.device.measure.framesByProbe ?? true))),
    run: async ({ app, seconds, scroll, what, dsym, probe, scenario }) => {
      const s = await ctx.session();
      const pkg = measuredApp(s, app);
      const name = scenario ?? (what === 'frames' ? 'trace' : what);
      /** A reading saved, its numbers kept, and said: `lines` above the noise, `after` (given the raw file) below it. */
      const answer = async (m: Measured<unknown>, o: Said) => {
        // the scroll stays with the reading: a look at this run on a regression does the same
        const saved = await save(o.kind, [m], { ...(m.value as object), scroll });
        const noise = await keep(s, {
          app: pkg,
          scenario: name,
          source: m.source ?? 'perf_trace',
          raw: saved.txt,
          metrics: o.metrics,
        });
        return reply(
          [
            `measurement ${saved.id}${virtualNote(s)}`,
            ...o.lines,
            ...noisy(noise),
            ...o.after(saved.txt),
          ].join('\n'),
          { id: saved.id, raw: saved.txt, virtualDevice: s.device.virtual, ...o.data, noise },
        );
      };
      if (what === 'xct_hitches' || what === 'xct_launch') {
        const test = what === 'xct_hitches' ? 'hitches' : 'launch';
        const m = await measure(s, 'xctMetrics')(pkg, test);
        return answer(m, xctSaid(what, m));
      }
      if (what === 'hangs') {
        const during = scroll ? await scroller(s, scroll, 500) : undefined;
        const m = await measure(s, 'hangs')(pkg, seconds, during, symbolsOf(s, dsym));
        if (scroll) s.acted();
        return answer(m, hangsSaid(m.value));
      }
      const record = measure(s, 'frameTrace', probe === false ? false : 'frames');
      await withProbe(s, pkg, probe);
      const during = scroll ? await scroller(s, scroll, 500) : undefined;
      const m = await record(pkg, seconds, during);
      if (scroll) s.acted();
      const v = m.value;
      if (v.kind === 'probe') return answer(m, probeSaid(v));
      if (v.kind === 'hitches') return answer(m, hitchesSaid(v));
      return answer(m, timelineSaid(v, s.device.virtual));
    },
  });
}
