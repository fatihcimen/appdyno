import { type Measured, reportProgress, pause, median } from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { refused } from '../session.js';
import { ScrollOut } from '../schemas.js';
import { swipeLine } from '../gesture-paths.js';
import { type Op, defineOp, ACT, reply } from '../tool.js';
import { perfTools, App, Probe, Scenario, measure, kb, virtual } from './shared.js';

/** Jank above this share of frames is worth a finding (Android vitals counts a session slow above 25 %). */
const JANK_PERCENT = 10;

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

export function perfScrollOp(ctx: ServerContext): Op {
  const { appOf, virtualNote, save, keep, noisy, withProbe } = perfTools(ctx);
  return defineOp({
    name: 'perf_scroll',
    title: 'Scroll performance',
    description:
      'Frames and memory while scrolling a list: each round resets the frames, swipes `swipes` times, and reads both once the list stops.',
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
    needs: 'frames',
    run: async ({ app, direction, swipes, repeats, probe, scenario }) => {
      const s = await ctx.session();
      s.appPid = undefined;
      const pkg = appOf(s, app);
      await withProbe(s, pkg, probe);
      const readFrames = measure(s, 'frames');
      const resetFrames = measure(s, 'resetFrames');
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
      for (let r = 0; r < repeats; r++) {
        reportProgress(`scroll round ${r + 1} of ${repeats}`);
        const m0 = await readMemory(pkg).catch(refused);
        await resetFrames(pkg).catch(refused);
        for (let i = 0; i < swipes; i++) {
          const { from, to } = swipeLine(size, { direction, distance: size.h * 0.4 });
          await s.device.swipe(from, to, 300, { settle: false }).catch(refused);
        }
        await pause(1_500).catch(refused);
        const f = await readFrames(pkg).catch(refused);
        const m1 = await readMemory(pkg).catch(refused);
        all.push(m0, f, m1);
        rounds.push({
          jankyPercent: f.value.jankyPercent,
          frozen: f.value.frozenFrames,
          frames: f.value.totalFrames,
          ...(f.value.p95Ms !== undefined && { p95Ms: f.value.p95Ms }),
          memStartKb: m0.value.kb,
          memEndKb: m1.value.kb,
          ...(m1.value.activities !== undefined && { activities: m1.value.activities }),
          ...(m1.value.appContexts !== undefined && { appContexts: m1.value.appContexts }),
          ...(m1.value.viewRootImpl !== undefined && { viewRootImpl: m1.value.viewRootImpl }),
        });
        limits = f.value.limits;
        if (f.value.stalls) stalls.push(f.value.stalls.worstMs);
      }
      s.acted();
      const counted = rounds.filter((x) => x.frames >= 60);
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
        ...(frozen > 0 ? [`frozen frames: ${frozen} (over 700 ms)`] : []),
        ...(growth !== undefined && growth > 0.3
          ? [`memory grows: ${Math.round(growth * 100)}% (from round 2 to the last)`]
          : []),
        ...leakSignal(rounds),
      ];
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
          { kind: 'frames.frozen', unit: 'count', samples: rounds.map((x) => x.frozen) },
          { kind: 'memory.end_kb', unit: 'kb', samples: rounds.map((x) => x.memEndKb) },
          { kind: 'stalls.worst_ms', unit: 'ms', samples: stalls },
        ],
      );
      return reply(
        [
          `measurement ${saved.id}${virtualNote(s)}`,
          ...rounds.map(
            (x, i) =>
              `round ${i + 1}: ${x.frames} frames, janky ${x.jankyPercent}%${x.p95Ms !== undefined ? `, p95 ${x.p95Ms} ms` : ''}, frozen ${x.frozen}, memory ${kb(x.memStartKb)} → ${kb(x.memEndKb)}`,
          ),
          `median jank: ${jank === undefined ? 'not enough frames' : `${jank}%`}`,
          ...(notes.length ? notes : ['no threshold exceeded']),
          ...(limits ? [limits] : []),
          ...noisy(noise),
          `raw output: ${saved.txt}`,
        ].join('\n'),
        {
          id: saved.id,
          raw: saved.txt,
          virtualDevice: virtual(s),
          rounds,
          ...(jank !== undefined && { jankMedianPercent: jank }),
          frozen,
          ...(growth !== undefined && { memGrowth: Math.round(growth * 1000) / 1000 }),
          findings: notes,
          noise,
        },
      );
    },
  });
}
