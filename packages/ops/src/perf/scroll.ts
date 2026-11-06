import {
  FROZEN_FRAME_MS,
  MIN_FRAMES,
  type FrameHistogram,
  type Measured,
  reportProgress,
  median,
} from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { ScrollOut } from './schemas.js';
import { swipeLine } from '../gesture-paths.js';
import { defineOp, ACT, reply } from '../tool.js';
import { perfTools, App, Probe, Scenario, kb } from './shared.js';
import { frameVitals } from './vitals.js';

/** Jank above this share of frames is worth a finding (Android vitals counts a session slow above 25 %). */
const JANK_PERCENT = 10;

/** What a recording around the swipes gives each, and the list's coasting after them. */
const SECONDS_A_SWIPE = 1.5;
const COAST_SECONDS = 2;

const OBJECTS = [
  ['activities', 'Activities'],
  ['appContexts', 'AppContexts'],
  ['viewRootImpl', 'ViewRootImpl'],
] as const;

/** Live objects that rise every round with nothing new on screen are not being freed. */
export function leakSignal(
  rounds: Partial<Record<(typeof OBJECTS)[number][0], number>>[],
): string[] {
  if (rounds.length < 2) return [];
  return OBJECTS.flatMap(([key, name]) => {
    const seen = rounds.map((r) => r[key]);
    if (seen.some((v) => v === undefined)) return [];
    const grew = seen.every((v, i) => i === 0 || v! > seen[i - 1]!);
    return grew ? [`${name} rose every round (${seen.join(' → ')}): likely a leak`] : [];
  });
}

export function perfScrollOp(ctx: ServerContext) {
  const { measure, appOf, virtualNote, save, keep, noisy, withProbe } = perfTools(ctx);
  return defineOp({
    name: 'perf_scroll',
    title: 'Scroll performance',
    description:
      'Frames, frozen frames and memory while scrolling a list: each round swipes `swipes` times, and reads both once the list stops.',
    input: z
      .object({
        app: App,
        direction: z.enum(['up', 'down']).default('up'),
        swipes: z.number().int().min(1).max(10).default(5),
        repeats: z.number().int().min(1).max(10).default(3),
        probe: Probe,
        scenario: Scenario,
      })
      .strict(),
    output: ScrollOut,
    annotations: ACT,
    run: async ({ app, direction, swipes, repeats, probe, scenario }) => {
      const s = await ctx.session();
      s.appPid = undefined;
      const pkg = appOf(s, app);
      const relaunched = await withProbe(s, pkg, probe);
      // turned off by the caller, which says nothing of the device
      const row = probe === false ? false : 'frames';
      const readMemory = measure(s, 'memory');
      const h = s.device.hello!;
      const size = (await s.current()).window ?? { w: h.screen.w, h: h.screen.h };
      const all: Measured<unknown>[] = [];
      const rounds: {
        jankyPercent: number;
        frozen: number;
        frames: number;
        p95Ms?: number;
        memStartKb: number;
        memEndKb: number;
        activities?: number;
        appContexts?: number;
        viewRootImpl?: number;
      }[] = [];
      let limits: string | undefined;
      const stalls: number[] = [];
      const hitches: number[] = [];
      const histograms: FrameHistogram[] = [];
      const swipeAll = async () => {
        for (let i = 0; i < swipes; i++) {
          const { from, to } = swipeLine(size, { direction, distance: size.h * 0.4 });
          await s.device.swipe(from, to, 300, { settle: false });
        }
      };
      const framesOfRound = () =>
        measure(s, 'framesDuring', row)(
          pkg,
          Math.ceil(swipes * SECONDS_A_SWIPE) + COAST_SECONDS,
          swipeAll,
        );
      for (let r = 0; r < repeats; r++) {
        reportProgress(`scroll round ${r + 1} of ${repeats}`);
        const m0 = await readMemory(pkg);
        const f = await framesOfRound();
        const m1 = await readMemory(pkg);
        all.push(m0, f, m1);
        rounds.push({
          jankyPercent: f.value.jankyPercent,
          frozen: f.value.frozenFrames,
          frames: f.value.histogram?.rowFrames ?? f.value.totalFrames,
          ...(f.value.p95Ms !== undefined && { p95Ms: f.value.p95Ms }),
          memStartKb: m0.value.kb,
          memEndKb: m1.value.kb,
          ...(m1.value.activities !== undefined && { activities: m1.value.activities }),
          ...(m1.value.appContexts !== undefined && { appContexts: m1.value.appContexts }),
          ...(m1.value.viewRootImpl !== undefined && { viewRootImpl: m1.value.viewRootImpl }),
        });
        limits = f.value.limits;
        if (f.value.histogram) histograms.push(f.value.histogram);
        if (f.value.stalls) stalls.push(f.value.stalls.worstMs);
        if (f.value.worstHitchMs !== undefined) hitches.push(f.value.worstHitchMs);
      }
      s.acted();
      const counted = rounds.filter((x) => x.frames >= MIN_FRAMES);
      const jank = counted.length ? median(counted.map((x) => x.jankyPercent)) : undefined;
      const frozen = rounds.reduce((a, x) => a + x.frozen, 0);
      // steady state: the second round's end to the last one's (the first loads images and caches)
      const growth =
        rounds.length >= 3
          ? (rounds.at(-1)!.memEndKb - rounds[1]!.memEndKb) / rounds[1]!.memEndKb
          : undefined;
      const saved = await save('scroll', all, {
        direction,
        swipes,
        repeats,
        rounds,
        jankMedianPercent: jank,
        frozen,
        memGrowth: growth,
      });
      const notes = [
        ...(jank !== undefined && jank > JANK_PERCENT
          ? [`high jank: median ${jank}% (threshold ${JANK_PERCENT}%)`]
          : []),
        ...(frozen > 0 ? [`frozen frames: ${frozen} (of ${FROZEN_FRAME_MS} ms or longer)`] : []),
        ...(growth !== undefined && growth > 0.3
          ? [`memory grows: ${Math.round(growth * 100)}% (from round 2 to the last)`]
          : []),
        ...leakSignal(rounds),
      ];
      const play = frameVitals(histograms);
      const noise = await keep(
        s,
        pkg,
        scenario ?? `scroll-${direction}`,
        'perf_scroll',
        saved.txt,
        [
          {
            kind: 'frames.jank_percent',
            unit: 'percent',
            samples: counted.map((x) => x.jankyPercent),
          },
          {
            kind: 'frames.p95_ms',
            unit: 'ms',
            samples: rounds.flatMap((x) => (x.p95Ms === undefined ? [] : [x.p95Ms])),
          },
          // the whole run's: one frozen frame in one round is not a median of none
          { kind: 'frames.frozen', unit: 'count', samples: [frozen] },
          { kind: 'hitches.worst_ms', unit: 'ms', samples: hitches },
          { kind: 'memory.end_kb', unit: 'kb', samples: rounds.map((x) => x.memEndKb) },
          { kind: 'stalls.worst_ms', unit: 'ms', samples: stalls },
          ...play.metrics,
        ],
      );
      return reply(
        [
          `measurement ${saved.id}${virtualNote(s)}`,
          ...relaunched,
          ...rounds.map(
            (x, i) =>
              `round ${i + 1}: ${x.frames} frames, janky ${x.jankyPercent}%${x.p95Ms !== undefined ? `, p95 ${x.p95Ms} ms` : ''}, frozen ${x.frozen}, memory ${kb(x.memStartKb)} → ${kb(x.memEndKb)}`,
          ),
          `median jank: ${jank === undefined ? 'not enough frames' : `${jank}%`}; frozen frames: ${frozen}`,
          ...(notes.length ? notes : ['no threshold exceeded']),
          ...(limits ? [limits] : []),
          ...play.lines,
          ...noisy(noise),
          `raw output: ${saved.txt}`,
        ].join('\n'),
        {
          id: saved.id,
          raw: saved.txt,
          virtualDevice: s.device.virtual,
          ...(relaunched.length && { relaunched: true }),
          rounds,
          ...(jank !== undefined && { jankMedianPercent: jank }),
          frozen,
          ...play.shares,
          ...(growth !== undefined && { memGrowth: Math.round(growth * 1000) / 1000 }),
          findings: notes,
          noise,
        },
      );
    },
  });
}
