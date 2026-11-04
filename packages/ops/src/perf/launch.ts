import { deviceClass, SLOW_LAUNCH_MS, type Metric } from '@appdyno/perf';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { LaunchOut } from './schemas.js';
import { defineOp, DESTRUCTIVE, reply } from '../tool.js';
import { perfTools, App, Probe, Scenario, deviceInfo } from './shared.js';
import { baselineLines, baselineVerdict } from './baseline.js';
import { dayLongest, playLine } from './vitals.js';

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
        baselineProfile: z
          .boolean()
          .optional()
          .describe('Android, a release build: in the APK, applied, cold starts with and without'),
        probe: Probe,
        scenario: Scenario,
      })
      .strict(),
    output: LaunchOut,
    annotations: DESTRUCTIVE,
    run: async ({ app, mode, repeats, compile, trace, baselineProfile, probe, scenario }) => {
      const s = await ctx.session();
      s.appPid = undefined;
      const pkg = appOf(s, app);
      if (baselineProfile) {
        const m = await measure(s, 'baselineProfile', false)(pkg, { repeats });
        s.acted();
        const saved = await save('launch', [m], m.value);
        const { present, state, applied, rules, without, with: withMs } = m.value;
        const noise = await keep(
          s,
          pkg,
          scenario ?? 'launch-baseline-profile',
          'perf_launch',
          saved.txt,
          [
            { kind: 'launch.without_profile_ms', unit: 'ms', samples: without },
            { kind: 'launch.with_profile_ms', unit: 'ms', samples: withMs },
          ],
        );
        return reply(
          [
            `measurement ${saved.id}${virtualNote(s)}`,
            ...baselineLines(m.value),
            ...noisy(noise),
            `raw output: ${saved.txt}`,
          ].join('\n'),
          {
            id: saved.id,
            raw: saved.txt,
            virtualDevice: s.device.virtual,
            mode: 'cold' as const,
            samples: withMs.map((totalMs) => ({ totalMs })),
            excessive: false,
            baselineProfile: {
              present,
              ...(state && { state }),
              applied,
              ...(rules && { rules }),
              withoutMs: without,
              withMs,
              ...(without.length > 0 && { verdict: baselineVerdict(m.value).verdict }),
            },
            noise,
          },
        );
      }
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
      const limit = SLOW_LAUNCH_MS[mode];
      const { medianMs: med, until, samples, startup, fullyDrawnMedianMs } = m.value;
      const name = scenario ?? `launch-${mode}`;
      const times = samples.flatMap((x) => (x.totalMs === undefined ? [] : [x.totalMs]));
      // Play keeps a state's longest start of the day, and only what the platform itself reports is its number
      const worstKind = `launch.worst_${mode}_ms` as const;
      const worst = !until && times.length ? Math.max(...times) : undefined;
      const noise = await keep(
        s,
        pkg,
        name,
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
            samples: times,
            // a tool's own mark is counted on this Mac; what a platform reports is its own
            ...(until && { throughHost: true }),
          },
          {
            kind: 'launch.ttfd_ms',
            unit: 'ms',
            samples: samples.flatMap((x) => (x.fullyDrawnMs === undefined ? [] : [x.fullyDrawnMs])),
          },
          { kind: worstKind, unit: 'ms', samples: worst === undefined ? [] : [worst] },
          ...(startup?.breakdown ?? []).map((b): Metric => ({
            kind: `launch.phase.${b.reason.replace(/\W+/g, '_').toLowerCase()}_ms`,
            unit: 'ms',
            samples: [b.ms],
          })),
        ],
        m.value.compile?.asked,
      );
      const onAndroid = s.device.platform === 'android';
      const longest =
        worst === undefined || !onAndroid
          ? undefined
          : await dayLongest(
              ctx.measurementsDir,
              { app: pkg, scenario: name, deviceClass: deviceClass(deviceInfo(s)) },
              { kind: worstKind, value: worst, at: m.at },
            );
      const over = longest !== undefined && longest >= limit;
      return reply(
        [
          `measurement ${saved.id}${virtualNote(s)}`,
          `${mode} launch${until ? ` (until ${until})` : ''}: ${samples.map((x) => `${x.totalMs ?? '?'} ms${until ? '' : ` (${x.state ?? '?'})`}`).join(', ')}`,
          `median: ${med === undefined ? 'not measured' : `${med} ms`}${worst === undefined ? '' : `, longest ${worst} ms`}`,
          ...(longest === undefined ? [] : [playLine(worstKind, longest)]),
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
          virtualDevice: s.device.virtual,
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
