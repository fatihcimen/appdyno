import type { Metric } from '@appdyno/perf';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { LaunchOut } from '../schemas.js';
import { defineOp, DESTRUCTIVE, reply } from '../tool.js';
import { perfTools, App, Probe, Scenario, virtual } from './shared.js';

export function perfLaunchOp(ctx: ServerContext) {
  const { measure, appOf, virtualNote, save, keep, noisy, withProbe } = perfTools(ctx);
  return defineOp({
    name: 'perf_launch',
    title: 'Launch time',
    description:
      'Launch time: cold (stopped first), warm (process alive, activity new) or hot (back from the background); a warm-up, then `repeats` launches. `trace` adds one start that names why it was slow. Android: `compile` sets the compile state (then reset). The app restarts.',
    input: z
      .object({
        app: App,
        mode: z.enum(['cold', 'warm', 'hot']).default('cold'),
        repeats: z.number().int().min(1).max(10).default(5),
        compile: z.enum(['speed', 'speed-profile', 'verify']).optional(),
        trace: z.boolean().optional(),
        probe: Probe,
        scenario: Scenario,
      })
      .strict(),
    output: LaunchOut,
    annotations: DESTRUCTIVE,
    needs: 'launch',
    run: async ({ app, mode, repeats, compile, trace, probe, scenario }) => {
      const s = await ctx.session();
      s.appPid = undefined;
      const pkg = appOf(s, app);
      // not by default: a kept launch stays one kind, whatever else measured this app
      await withProbe(s, pkg, probe ?? false);
      const m = await measure(
        s,
        'launch',
        trace ? 'launch-why' : 'launch',
      )(pkg, {
        mode,
        repeats,
        ...(compile && { compile }),
        ...(trace && { trace }),
        ...(probe && { probe }),
      });
      s.acted();
      const saved = await save('launch', [m], m.value);
      // Android vitals: excessive cold ≥ 5 s, warm ≥ 2 s, hot ≥ 1.5 s
      const limit = { cold: 5_000, warm: 2_000, hot: 1_500 }[mode];
      const { medianMs: med, until, samples, startup, fullyDrawnMedianMs } = m.value;
      const noise = await keep(
        s,
        pkg,
        scenario ?? `launch-${mode}`,
        'perf_launch',
        saved.txt,
        [
          {
            kind: !until
              ? 'launch.ttid_ms'
              : until.includes('first frame')
                ? 'launch.first_frame_ms'
                : 'launch.until_ms',
            unit: 'ms',
            samples: samples.flatMap((x) => (x.totalMs === undefined ? [] : [x.totalMs])),
            // a tool's own mark is counted on this Mac; what a platform reports is its own
            ...(until && { throughHost: true }),
          },
          {
            kind: 'launch.ttfd_ms',
            unit: 'ms',
            samples: samples.flatMap((x) => (x.fullyDrawnMs === undefined ? [] : [x.fullyDrawnMs])),
          },
          ...(startup?.breakdown ?? []).map((b): Metric => ({
            kind: `launch.phase.${b.reason.replace(/\W+/g, '_').toLowerCase()}_ms`,
            unit: 'ms',
            samples: [b.ms],
          })),
        ],
        m.value.compile?.asked,
      );
      // a time counted to a tool's own mark (`until`) is not the system's launch time the limit is about
      const over = !until && med !== undefined && med >= limit;
      return reply(
        [
          `measurement ${saved.id}${virtualNote(s)}`,
          `${mode} launch${until ? ` (until ${until})` : ''}: ${samples.map((x) => `${x.totalMs ?? '?'} ms${until ? '' : ` (${x.state ?? '?'})`}`).join(', ')}`,
          `median: ${med === undefined ? 'not measured' : `${med} ms`}${over ? ` (excessive: threshold ${limit} ms)` : ''}`,
          ...(fullyDrawnMedianMs !== undefined ? [`fully drawn: ${fullyDrawnMedianMs} ms`] : []),
          ...(m.value.compile
            ? [
                `compile: ${m.value.compile.asked}${m.value.compile.status ? ` (${m.value.compile.status})` : ''}, reset afterwards`,
              ]
            : []),
          ...(startup
            ? [
                `start trace: ${startup.startupType ?? '?'} ${startup.durMs ?? '?'} ms${startup.odex ? `, ${startup.odex}` : ''}`,
                ...(startup.reasons.length
                  ? [`slow start reasons: ${startup.reasons.join('; ')}`]
                  : []),
                ...startup.findings.map((x) => `finding: ${x}`),
                ...(startup.breakdown.length
                  ? [
                      `where the time went: ${startup.breakdown
                        .slice(0, 6)
                        .map((b) => `${b.reason} ${b.ms} ms`)
                        .join(', ')}`,
                    ]
                  : []),
                `trace (perf_query): ${startup.tracePath}`,
              ]
            : []),
          ...noisy(noise),
          `raw output: ${saved.txt}`,
        ].join('\n'),
        {
          id: saved.id,
          raw: saved.txt,
          virtualDevice: virtual(s),
          mode,
          samples: samples.map((x) => ({
            ...(x.totalMs !== undefined && { totalMs: x.totalMs }),
            ...(x.state && { state: x.state }),
          })),
          ...(med !== undefined && { medianMs: med }),
          excessive: over,
          ...(fullyDrawnMedianMs !== undefined && { fullyDrawnMedianMs }),
          ...(m.value.compile && { compile: m.value.compile.asked }),
          ...(startup && {
            tracePath: startup.tracePath,
            reasons: startup.reasons,
            findings: startup.findings,
          }),
          noise,
        },
      );
    },
  });
}
