import {
  FROZEN_FRAME_MS,
  MIN_FRAMES,
  type FrameHistogram,
  type Measured,
  pause,
  reportProgress,
  median,
  must,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { moved } from '../scroll.js';
import { ScrollOut } from './schemas.js';
import { defineOp, ACT, reply } from '../tool.js';
import { perfTools, App, Probe, Scenario, kb } from './shared.js';
import { frameVitals } from './vitals.js';

/** Jank above this share of frames is worth a finding: this tool's own line, and none of Play's (`vitals.ts`). */
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
    const seen = rounds.map((r) => r[key]).filter((v) => v !== undefined);
    if (seen.length < rounds.length) return [];
    const grew = seen.every((v, i) => i === 0 || v > must(seen[i - 1], 'the round before'));
    return grew ? [`${name} rose every round (${seen.join(' → ')}): likely a leak`] : [];
  });
}

export function perfScrollOp(ctx: ServerContext) {
  const { measure, appOf, virtualNote, save, keep, noisy, withProbe, scroller } = perfTools(ctx);
  return defineOp({
    name: 'perf_scroll',
    title: 'Scroll performance',
    description:
      'Scroll jank: frames, frozen frames and memory while scrolling a list, in rounds of `swipes` swipes into new rows, read once the list stops. A list at its end is brought back for a round, which the answer says.',
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
      await withProbe(s, pkg, probe);
      // turned off by the caller, which says nothing of the device
      const row = probe === false ? false : 'frames';
      const readMemory = measure(s, 'memory');
      const all: Measured<unknown>[] = [];
      const rounds: {
        rewound?: boolean;
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
      const swipeAll = await scroller(s, direction, 0, swipes);
      const swipeBack = await scroller(s, direction === 'up' ? 'down' : 'up', 0, swipes);
      const framesOfRound = () =>
        measure(s, 'framesDuring', row)(
          pkg,
          Math.ceil(swipes * SECONDS_A_SWIPE) + COAST_SECONDS,
          swipeAll,
        );
      /**
       * A round that moved the list, read from the screen: past its end a phone draws frames of nothing, which read as
       * smooth, or refuses a round that has none.
       */
      const roundThatMoved = async () => {
        const was = await s.read();
        const f = await framesOfRound().catch((e: unknown) => {
          if (e instanceof DeviceError && e.code === 'CHECK_FAILED') return undefined;
          throw e;
        });
        return f && moved(was.list, (await s.read()).list) ? f : undefined;
      };
      let ended = false;
      for (let r = 0; r < repeats; r++) {
        reportProgress(`scroll round ${r + 1} of ${repeats}`);
        const m0 = await readMemory(pkg);
        // new rows are the cost a person feels, so a list goes on for as long as it moves, and one that has ended comes
        // back for each round after; a first round that cannot is a screen that does not scroll, said as it is
        let f = r === 0 ? await framesOfRound() : ended ? undefined : await roundThatMoved();
        if (!f && r > 0) {
          ended = true;
          await swipeBack();
          // at rest first, or the round would count the list's coasting
          await pause(COAST_SECONDS * 1_000);
          f = await roundThatMoved();
        }
        if (!f) break;
        const m1 = await readMemory(pkg);
        all.push(m0, f, m1);
        rounds.push({
          jankyPercent: f.value.jankyPercent,
          frozen: f.value.frozenFrames,
          frames: f.value.histogram?.rowFrames ?? f.value.totalFrames,
          ...(ended && { rewound: true }),
          ...(f.value.p95Ms !== undefined && { p95Ms: f.value.p95Ms }),
          memStartKb: m0.value.kb,
          memEndKb: m1.value.kb,
          ...(m1.value.activities !== undefined && { activities: m1.value.activities }),
          ...(m1.value.appContexts !== undefined && { appContexts: m1.value.appContexts }),
          ...(m1.value.viewRootImpl !== undefined && { viewRootImpl: m1.value.viewRootImpl }),
        });
        limits = f.value.limits;
        if (f.value.histogram) histograms.push(f.value.histogram);
        // the worst of no frames is none, and not a good round
        if (f.value.totalFrames > 0 && f.value.stalls) stalls.push(f.value.stalls.worstMs);
        if (f.value.totalFrames > 0 && f.value.worstHitchMs !== undefined)
          hitches.push(f.value.worstHitchMs);
      }
      s.acted();
      const counted = rounds.filter((x) => x.frames >= MIN_FRAMES);
      const jank = counted.length ? median(counted.map((x) => x.jankyPercent)) : undefined;
      const frozen = rounds.reduce((a, x) => a + x.frozen, 0);
      // steady state: the second round's end to the last one's (the first loads images and caches)
      const [, second] = rounds;
      const last = rounds.at(-1);
      const growth =
        rounds.length >= 3 && second && last
          ? (last.memEndKb - second.memEndKb) / second.memEndKb
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
        ...rounds.flatMap((x, i) =>
          x.rewound
            ? [`round ${i + 1} ran after the list was brought back, over rows already seen`]
            : [],
        ),
        ...(rounds.length < repeats
          ? [`the list stopped moving: ${rounds.length} of ${repeats} rounds`]
          : []),
      ];
      const play = frameVitals(histograms);
      const noise = await keep(s, {
        app: pkg,
        scenario: scenario ?? `scroll-${direction}`,
        source: 'perf_scroll',
        raw: saved.txt,
        metrics: [
          {
            kind: 'frames.jank_percent',
            unit: 'percent',
            samples: counted.map((x) => x.jankyPercent),
          },
          {
            kind: 'frames.p95_ms',
            unit: 'ms',
            samples: counted.flatMap((x) => (x.p95Ms === undefined ? [] : [x.p95Ms])),
          },
          // the whole run's: one frozen frame in one round is not a median of none
          {
            kind: 'frames.frozen',
            unit: 'count',
            samples: rounds.some((x) => x.frames > 0) ? [frozen] : [],
          },
          { kind: 'hitches.worst_ms', unit: 'ms', samples: hitches },
          { kind: 'memory.end_kb', unit: 'kb', samples: rounds.map((x) => x.memEndKb) },
          { kind: 'stalls.worst_ms', unit: 'ms', samples: stalls },
          ...play.metrics,
        ],
      });
      return reply(
        [
          `measurement ${saved.id}${virtualNote(s)}`,
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
