import {
  COMPILE_MODES,
  must,
  reportProgress,
  type CompileMode,
  type LaunchMode,
} from '@appdyno/core';
import {
  deviceClass,
  loadBaseline,
  MIN_BASELINE_RUNS,
  phaseKind,
  ratedByPlay,
  runsIn,
  SLOW_LAUNCH_MS,
  type Metric,
  type RunKey,
} from '@appdyno/perf';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { LaunchOut } from './schemas.js';
import type { Session } from '../session.js';
import { defineOp, DESTRUCTIVE, reply, ToolError } from '../tool.js';
import { keepBaseline } from './compare.js';
import { perfTools, App, Probe, Scenario, deviceInfo, rewriteDashboard } from './shared.js';
import { baselineLines, baselineVerdict } from './baseline.js';
import { dayLongest, playLine } from './vitals.js';

type Tools = ReturnType<typeof perfTools>;

/** One run of a warm-up and `repeats` launches, kept under `key`: its lines and its answer. */
async function launchRun(
  ctx: ServerContext,
  { measure, virtualNote, save, keep, noisy }: Tools,
  s: Session,
  key: RunKey,
  o: {
    mode: LaunchMode;
    repeats: number;
    compile?: CompileMode | undefined;
    trace?: boolean | undefined;
    probe?: boolean | undefined;
  },
) {
  const { app: pkg, scenario: name } = key;
  const { mode, repeats, compile, trace, probe } = o;
  // not by default: a kept launch stays one kind, whatever else measured this app; a launch relaunches anyway
  if (probe) await measure(s, 'attachProbe')(pkg);
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
  // a start the system timed as another state is none of this mode's: a chooser in front reads UNKNOWN, at 0 ms
  const counted = samples.filter(
    (x) => x.totalMs !== undefined && !(x.state && x.state !== mode.toUpperCase()),
  );
  const times = counted.flatMap((x) => x.totalMs ?? []);
  // what the median is of, where it is not every start: under load a start timed out, or found the app still running
  const others = samples.filter((x) => !counted.includes(x)).map((x) => x.state ?? '?');
  const of = others.length
    ? `, of ${counted.length} of the ${samples.length} starts: the system timed the others as ${others.join(', ')}, not as ${mode.toUpperCase()}`
    : '';
  // Play keeps a state's longest start of the day, and only what the platform itself reports is its number
  const worstKind = `launch.worst_${mode}_ms` as const;
  const worst = !until && times.length ? Math.max(...times) : undefined;
  const noise = await keep(s, {
    app: pkg,
    scenario: name,
    source: 'perf_launch',
    raw: saved.txt,
    metrics: [
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
        samples: counted.flatMap((x) => (x.fullyDrawnMs === undefined ? [] : [x.fullyDrawnMs])),
      },
      { kind: worstKind, unit: 'ms', samples: worst === undefined ? [] : [worst] },
      ...(startup?.breakdown ?? []).map((b): Metric => ({
        kind: phaseKind(b.reason),
        unit: 'ms',
        samples: [b.ms],
      })),
    ],
    compile: m.value.compile?.asked,
  });
  const rated = ratedByPlay(s.device.platform);
  const longest =
    worst === undefined || !rated
      ? undefined
      : await dayLongest(
          ctx.measurementsDir,
          { app: pkg, scenario: name, deviceClass: deviceClass(deviceInfo(s)) },
          { kind: worstKind, value: worst, at: m.at },
        );
  const over = longest !== undefined && longest >= limit;
  return {
    lines: [
      `measurement ${saved.id}${virtualNote(s)}`,
      `${mode} launch${until ? ` (until ${until})` : ''}: ${samples.map((x) => `${x.totalMs ?? '?'} ms${until ? '' : ` (${x.state ?? '?'})`}`).join(', ')}`,
      `median: ${med === undefined ? `not measured${samples.some((x) => x.state) ? `: the system timed no start as ${mode.toUpperCase()}; a start reads UNKNOWN where another window came to the front, or the system stopped waiting for it` : ''}` : `${med} ms`}${worst === undefined ? '' : `, longest ${worst} ms`}${med === undefined ? '' : of}`,
      ...(longest === undefined ? [] : [playLine(worstKind, longest)]),
      ...(med !== undefined && !rated ? [UNRATED] : []),
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
      // where it was before is not where a start leaves it: the next call must not take it for that screen
      ...(mode === 'hot' ? [] : [RESTARTED]),
      ...noisy(noise),
      `raw output: ${saved.txt}`,
    ],
    data: {
      id: saved.id,
      raw: saved.txt,
      virtualDevice: s.device.virtual,
      mode,
      samples: samples.map((x) => ({
        ...(x.totalMs !== undefined && { totalMs: x.totalMs }),
        ...(x.state && { state: x.state }),
      })),
      ...(med !== undefined && { medianMs: med }),
      ...(longest !== undefined && { excessive: over }),
      ...(fullyDrawnMedianMs !== undefined && { fullyDrawnMedianMs }),
      ...(m.value.compile && { compile: m.value.compile.asked }),
      ...(startup && {
        tracePath: startup.tracePath,
        reasons: startup.reasons,
        findings: startup.findings,
      }),
      noise,
    },
  };
}

/** What a run is kept as, said where it is: a run alone is no baseline, and a regression is called against one. */
async function nextOf(ctx: ServerContext, key: RunKey) {
  const held = runsIn(await loadBaseline(ctx.perfDir, key));
  if (held >= MIN_BASELINE_RUNS)
    return `perf_compare with scenario ${key.scenario} compares this run with its baseline of ${held} runs`;
  return `kept as one run of ${key.scenario}, not as a baseline: ${held ? `its baseline holds ${held} of the ${MIN_BASELINE_RUNS} runs it needs` : 'it has none'}; perf_launch with baseline: true measures ${MIN_BASELINE_RUNS} runs and keeps them as one`;
}

/** What a cold or warm start leaves the app on. */
const RESTARTED = 'the app was started anew: it shows its first screen';

/** Where no store rates a start, what tells a slow one is the app's own runs before. */
const UNRATED =
  'no limit of a slow start is rated on this platform: judge it against a baseline (perf_launch baseline: true, then perf_compare)';

export function perfLaunchOp(ctx: ServerContext) {
  const tools = perfTools(ctx);
  const { measure, measuredApp, virtualNote, save, keep, noisy } = tools;
  return defineOp({
    name: 'perf_launch',
    title: 'Launch time',
    description:
      'App startup time: cold (stopped first), warm (process alive, activity new) or hot (back from the background); a warm-up, then `repeats` launches. `trace` adds one start that names why it was slow. Android: `compile` sets the compile state (then reset). The app restarts.',
    input: z
      .object({
        app: App,
        mode: z.enum(['cold', 'warm', 'hot']).default('cold'),
        repeats: z.number().int().min(1).max(10).default(5),
        compile: z.enum(COMPILE_MODES).optional(),
        trace: z.boolean().optional(),
        baselineProfile: z
          .boolean()
          .optional()
          .describe('Android, a release build: in the APK, applied, cold starts with and without'),
        probe: Probe,
        scenario: Scenario,
        baseline: z
          .boolean()
          .optional()
          .describe(`${MIN_BASELINE_RUNS} runs, added to perf_compare's baseline`),
      })
      .strict(),
    output: LaunchOut,
    annotations: DESTRUCTIVE,
    run: async ({
      app,
      mode,
      repeats,
      compile,
      trace,
      baselineProfile,
      probe,
      scenario,
      baseline,
    }) => {
      const s = await ctx.session();
      const pkg = measuredApp(s, app);
      if (baselineProfile) {
        if (baseline)
          throw new ToolError(
            'baselineProfile measures a Baseline Profile, and baseline keeps launches: one or the other',
            'INVALID_ARGUMENT',
          );
        const m = await measure(s, 'baselineProfile', false)(pkg, { repeats });
        s.acted();
        const saved = await save('launch', [m], m.value);
        const { present, state, applied, rules, without, with: withMs } = m.value;
        const noise = await keep(s, {
          app: pkg,
          scenario: scenario ?? 'launch-baseline-profile',
          source: 'perf_launch',
          raw: saved.txt,
          metrics: [
            { kind: 'launch.without_profile_ms', unit: 'ms', samples: without },
            { kind: 'launch.with_profile_ms', unit: 'ms', samples: withMs },
          ],
        });
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
      const key = {
        app: pkg,
        scenario: scenario ?? `launch-${mode}`,
        deviceClass: deviceClass(deviceInfo(s)),
      };
      const o = { mode, repeats, compile, trace, probe };
      if (!baseline) {
        const { lines, data } = await launchRun(ctx, tools, s, key, o);
        const next = await nextOf(ctx, key);
        return reply([...lines, next].join('\n'), { ...data, next });
      }
      const runs: Awaited<ReturnType<typeof launchRun>>[] = [];
      for (let i = 1; i <= MIN_BASELINE_RUNS; i++) {
        reportProgress(`run ${i} of the ${MIN_BASELINE_RUNS} a baseline takes`);
        runs.push(await launchRun(ctx, tools, s, key, o));
      }
      const kept = await keepBaseline(ctx, key, MIN_BASELINE_RUNS);
      await rewriteDashboard(ctx);
      const next = kept.ready
        ? `perf_compare with scenario ${key.scenario} compares a later run with it`
        : `not a baseline yet: ${kept.lines.join('; ')}`;
      return reply(
        [
          ...runs.flatMap((r, i) => [`run ${i + 1} of ${MIN_BASELINE_RUNS}:`, ...r.lines]),
          ...kept.lines,
          next,
        ].join('\n'),
        {
          ...must(runs.at(-1), 'the last run').data,
          ...(kept.file && { baselineFile: kept.file }),
          next,
        },
      );
    },
  });
}
