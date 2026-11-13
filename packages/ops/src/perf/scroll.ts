import {
  FROZEN_FRAME_MS,
  MIN_FRAMES,
  type FrameHistogram,
  type FrameStats,
  type Measured,
  type MemoryReading,
  type ProfileEntry,
  type SurfaceFrames,
  pause,
  reportProgress,
  median,
  round1,
  must,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import type { Metric } from '@appdyno/perf';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import type { Session } from '../session.js';
import { moved } from '../scroll.js';
import { ScrollOut } from './schemas.js';
import { defineOp, ACT, reply, ToolError } from '../tool.js';
import { perfTools, App, Probe, Scenario, kb } from './shared.js';
import { frameVitals, playLine } from './vitals.js';

/** Jank above this share of frames is worth a finding: this tool's own line, and none of Play's (`vitals.ts`). */
const JANK_PERCENT = 10;

/** The rounds a run kept under a scenario has, for the median a baseline or a compare takes. */
const BASELINE_ROUNDS = 3;

/** What a recording around the swipes gives each, and the list's coasting after them. */
const SECONDS_A_SWIPE = 1.5;
const COAST_SECONDS = 2;

const OBJECTS = [
  ['activities', 'Activities'],
  ['appContexts', 'AppContexts'],
  ['viewRootImpl', 'ViewRootImpl'],
] as const;

/** A round's reading. */
/** What a scroll keeps of its rounds: the View toolkit's frames, or a surface's own, and memory, stalls and hitches. */
function scrollMetrics(
  rounds: Round[],
  o: { frozen: number; hitches: number[]; stalls: number[] },
): Metric[] {
  const counted = rounds.filter((x) => x.frames >= MIN_FRAMES);
  const surfaced = rounds.flatMap((x) => (x.surface ? [x.surface] : []));
  return [
    { kind: 'frames.jank_percent', unit: 'percent', samples: counted.map((x) => x.jankyPercent) },
    {
      kind: 'frames.p95_ms',
      unit: 'ms',
      samples: counted.flatMap((x) => (x.p95Ms === undefined ? [] : [x.p95Ms])),
    },
    // the whole run's: one frozen frame in one round is not a median of none
    {
      kind: 'frames.frozen',
      unit: 'count',
      samples: rounds.some((x) => x.frames > 0) ? [o.frozen] : [],
    },
    { kind: 'hitches.worst_ms', unit: 'ms', samples: o.hitches },
    { kind: 'memory.end_kb', unit: 'kb', samples: rounds.map((x) => x.memEndKb) },
    { kind: 'stalls.worst_ms', unit: 'ms', samples: o.stalls },
    // a surface's own, as perf_snapshot keeps them: each round's
    { kind: 'surface.p95_ms', unit: 'ms', samples: surfaced.map((x) => x.p95Ms) },
    {
      kind: 'surface.slow_34_percent',
      unit: 'percent',
      samples: surfaced.map((x) => x.slow34Percent),
    },
    {
      kind: 'surface.slow_50_percent',
      unit: 'percent',
      samples: surfaced.map((x) => x.slow50Percent),
    },
  ];
}

/** A round's frames on a surface of the app's own, where the View toolkit counted too few. */
type OnSurface = Pick<
  SurfaceFrames,
  'frames' | 'fps' | 'p95Ms' | 'slow34Percent' | 'slow50Percent' | 'refreshMs'
>;

type Round = {
  rewound?: boolean;
  jankyPercent: number;
  frozen: number;
  frames: number;
  p95Ms?: number;
  surface?: OnSurface;
  memStartKb: number;
  memEndKb: number;
  activities?: number;
  appContexts?: number;
  viewRootImpl?: number;
};

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

/** A round's reading, of its frames and the memory before and after it. */
const roundOf = (f: FrameStats, m0: MemoryReading, m1: MemoryReading, rewound: boolean): Round => ({
  jankyPercent: f.jankyPercent,
  frozen: f.frozenFrames,
  frames: f.histogram?.rowFrames ?? f.totalFrames,
  ...(rewound && { rewound: true }),
  ...(f.p95Ms !== undefined && { p95Ms: f.p95Ms }),
  // a Flutter app or a game draws on its own surface, which the View toolkit counts nothing of
  ...((f.histogram?.rowFrames ?? f.totalFrames) < MIN_FRAMES &&
    f.surface &&
    f.surface.frames >= MIN_FRAMES && {
      surface: {
        frames: f.surface.frames,
        fps: f.surface.fps,
        p95Ms: f.surface.p95Ms,
        slow34Percent: f.surface.slow34Percent,
        slow50Percent: f.surface.slow50Percent,
        refreshMs: f.surface.refreshMs,
      },
    }),
  memStartKb: m0.kb,
  memEndKb: m1.kb,
  ...(m1.activities !== undefined && { activities: m1.activities }),
  ...(m1.appContexts !== undefined && { appContexts: m1.appContexts }),
  ...(m1.viewRootImpl !== undefined && { viewRootImpl: m1.viewRootImpl }),
});

/** What the rounds found past a threshold, and what a reader of them should know. */
function findings(
  rounds: Round[],
  o: {
    repeats: number;
    jank: number | undefined;
    frozen: number;
    growth: number | undefined;
    busiest: ProfileEntry | undefined;
  },
) {
  const { repeats, jank, frozen, growth, busiest } = o;
  return [
    ...(jank !== undefined && jank > JANK_PERCENT
      ? [`high jank: median ${jank}% (threshold ${JANK_PERCENT}%)`]
      : []),
    ...(frozen > 0 ? [`frozen frames: ${frozen} (of ${FROZEN_FRAME_MS} ms or longer)`] : []),
    ...(growth !== undefined && growth > 0.3
      ? [`memory grows: ${Math.round(growth * 100)}% (from round 2 to the last)`]
      : []),
    ...(busiest
      ? [
          `the app's top function as it scrolled: ${busiest.symbol}, ${busiest.percent}% of its samples`,
        ]
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
}

/**
 * A scroll whose rounds drew too few frames to judge, which is no pass; an app that draws on its own surface, as
 * Flutter or a game engine does, draws past the frames counted here, and where the device reads that surface it says so.
 */
async function unjudged(s: Session, pkg: string) {
  const surface = await s.device.measure.surfaceFrames(pkg).catch(() => undefined);
  const drew = surface?.value.frames ?? 0;
  return `nothing judged: no round drew the ${MIN_FRAMES} frames a share takes${drew > 0 ? `; the app's own surface drew ${drew} frames, which are not counted here: perf_snapshot with also: ['surface'] reads them` : ''}`;
}

export function perfScrollOp(ctx: ServerContext) {
  const { measure, measuredApp, virtualNote, save, keep, noisy, withProbe, scroller } =
    perfTools(ctx);
  return defineOp({
    name: 'perf_scroll',
    title: 'Scroll performance',
    description:
      'Scroll jank: frames, frozen frames and memory of a list, in rounds of `swipes` swipes into new rows, read once it stops: one, three under a scenario. A list at its end comes back for a round; one the swipes do not move is refused. Jank names its top function. iOS simulator: the first call puts the frame probe in, restarting the app, and measures nothing: open the list again and call again.',
    input: z
      .object({
        app: App,
        direction: z.enum(['up', 'down']).default('up'),
        swipes: z.number().int().min(1).max(10).default(5),
        repeats: z.number().int().min(1).max(10).optional(),
        probe: Probe,
        scenario: Scenario,
      })
      .strict(),
    output: ScrollOut,
    annotations: ACT,
    run: async ({ app, direction, swipes, repeats: asked, probe, scenario }) => {
      // a reading is one round; what is kept under a name, for a baseline or a compare, has three to take a median of
      const repeats = asked ?? (scenario ? BASELINE_ROUNDS : 1);
      const s = await ctx.session();
      const pkg = measuredApp(s, app);
      await withProbe(s, pkg, probe);
      // turned off by the caller, which says nothing of the device
      const row = probe === false ? false : 'frames';
      const readMemory = measure(s, 'memory');
      const all: Measured<unknown>[] = [];
      const rounds: Round[] = [];
      let limits: string | undefined;
      const stalls: number[] = [];
      const hitches: number[] = [];
      const histograms: FrameHistogram[] = [];
      const swipeAll = await scroller(s, direction, 0, swipes);
      const swipeBack = await scroller(s, direction === 'up' ? 'down' : 'up', 0, swipes);
      const roundSeconds = Math.ceil(swipes * SECONDS_A_SWIPE) + COAST_SECONDS;
      const framesOfRound = () => measure(s, 'framesDuring', row)(pkg, roundSeconds, swipeAll);
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
        // new rows are the cost a person feels, so a list goes on for as long as it moves, and one at its end, the first
        // round's too, comes back for each round after; a screen it moves neither way, as a popup over the list, would
        // read as smooth, and is refused
        let f = ended ? undefined : await roundThatMoved();
        if (!f) {
          ended = true;
          await swipeBack();
          // at rest first, or the round would count the list's coasting
          await pause(COAST_SECONDS * 1_000);
          f = await roundThatMoved();
        }
        if (!f && r === 0)
          throw new ToolError(
            'the swipes moved nothing on this screen, so no scroll was measured: a popup or a sheet over the list takes them, or there is no list',
            'NOT_FOUND',
            'read the screen, close what covers the list or open the one to measure, and call again',
          );
        if (!f) break;
        const m1 = await readMemory(pkg);
        all.push(m0, f, m1);
        rounds.push(roundOf(f.value, m0.value, m1.value, ended));
        limits = f.value.limits;
        if (f.value.histogram) histograms.push(f.value.histogram);
        // the worst of no frames is none, and not a good round
        if (f.value.totalFrames > 0 && f.value.stalls) stalls.push(f.value.stalls.worstMs);
        if (f.value.totalFrames > 0 && f.value.worstHitchMs !== undefined)
          hitches.push(f.value.worstHitchMs);
      }
      const counted = rounds.filter((x) => x.frames >= MIN_FRAMES);
      const surfaced = rounds.flatMap((x) => (x.surface ? [x.surface] : []));
      /** The median of the surface's rounds: 0 with none, where nothing says it. */
      const onSurface = (pick: (x: OnSurface) => number) =>
        surfaced.length ? round1(median(surfaced.map(pick))) : 0;
      const jank = counted.length ? round1(median(counted.map((x) => x.jankyPercent))) : undefined;
      // what the app spent its time on as it janked: one scroll more, under the profiler, where the device has one; it
      // counts in no round, as the profiler costs the frames something
      const profiles = jank !== undefined && jank > JANK_PERCENT;
      // a profile that does not come is said, as its time was: a device without a profiler says nothing
      let unprofiled: string | undefined;
      if (profiles)
        reportProgress(
          'one scroll more under the profiler, to name what the app spent its time on',
        );
      const busiest = profiles
        ? await measure(s, 'cpuProfile', false)(pkg, roundSeconds * 1_000, swipeAll).then(
            (p) => {
              const top = p.value.appTop?.[0] ?? p.value.top[0];
              if (!top) unprofiled = 'the profile of one scroll more named no function';
              return top;
            },
            (e: unknown) => {
              if (!(e instanceof DeviceError && e.code === 'UNSUPPORTED'))
                unprofiled = `no top function: the profile of one scroll more failed: ${e instanceof Error ? e.message : String(e)}`;
              return undefined;
            },
          )
        : undefined;
      s.acted();
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
      const notes = findings(rounds, { repeats, jank, frozen, growth, busiest });
      const play = frameVitals(histograms);
      const noise = await keep(s, {
        app: pkg,
        scenario: scenario ?? `scroll-${direction}`,
        source: 'perf_scroll',
        raw: saved.txt,
        metrics: [...scrollMetrics(rounds, { frozen, hitches, stalls }), ...play.metrics],
      });
      return reply(
        [
          `measurement ${saved.id}${virtualNote(s)}`,
          ...rounds.map((x, i) =>
            x.surface
              ? `round ${i + 1}: on its own surface, ${x.surface.frames} frames, ${x.surface.fps} a second, p95 ${x.surface.p95Ms} ms, ${x.surface.slow34Percent}% 34 ms or more after the last, memory ${kb(x.memStartKb)} → ${kb(x.memEndKb)}`
              : `round ${i + 1}: ${x.frames} frames, janky ${x.jankyPercent}%${x.p95Ms !== undefined ? `, p95 ${x.p95Ms} ms` : ''}, frozen ${x.frozen}, memory ${kb(x.memStartKb)} → ${kb(x.memEndKb)}`,
          ),
          ...(surfaced.length && !counted.length
            ? [
                `median on its own surface: p95 ${onSurface((x) => x.p95Ms)} ms, ${onSurface((x) => x.slow34Percent)}% 34 ms or more after the last, ${onSurface((x) => x.slow50Percent)}% 50 ms or more`,
                playLine(
                  'surface.slow_50_percent',
                  must(
                    onSurface((x) => x.slow50Percent),
                    'a share',
                  ),
                ),
                playLine(
                  'surface.slow_34_percent',
                  must(
                    onSurface((x) => x.slow34Percent),
                    'a share',
                  ),
                ),
                ...notes,
              ]
            : [
                `median jank: ${jank === undefined ? 'not enough frames' : `${jank}%`}; frozen frames: ${frozen}`,
                ...(notes.length
                  ? notes
                  : counted.length
                    ? ['no threshold exceeded']
                    : [await unjudged(s, pkg)]),
              ]),
          ...(unprofiled ? [unprofiled] : []),
          ...(limits ? [limits] : []),
          // Play's shares of the View toolkit's frames say nothing of a surface's, which it has its own lines of
          ...(surfaced.length && !counted.length ? [] : play.lines),
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
