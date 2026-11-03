import { mkdir } from 'node:fs/promises';
import { cpus, loadavg } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  pause,
  reportProgress,
  stateDir,
  type Capability,
  type HeapReading,
  type Measured,
  type MeasureSource,
  type TraceDigest,
} from '@appdyno/core';
import {
  addToBaseline,
  exitCode,
  latestRuns,
  loadBaseline,
  loadBudgets,
  newId,
  recordsOf,
  reportKey,
  runKeys,
  saveBaseline,
  saveRun,
  store,
  toJson,
  toJUnit,
  toText,
  type KeyReport,
  type Metric,
} from '@appdyno/perf';
import { DeviceError } from '@appdyno/protocol';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { checkApp } from './policy.js';
import { refused, type Session } from './session.js';
import {
  CompareOut,
  HeapOut,
  LaunchOut,
  ProfileOut,
  QueryOut,
  ScrollOut,
  SnapshotOut,
  TraceOut,
} from './schemas.js';
import { swipeLine } from './steps.js';
import { ACT, defineOp, DESTRUCTIVE, READ, reply, ToolError, type Op } from './tool.js';

const App = z
  .string()
  .max(200)
  .optional()
  .describe('package or bundle id; default: the selected app');

const Scenario = z
  .string()
  .regex(/^[\w.-]{1,60}$/)
  .optional()
  .describe('the name this run is kept under for perf_compare; default: by operation');
const Probe = z
  .boolean()
  .optional()
  .describe('iOS simulator: measure through the injected frame probe (relaunches the app once)');

/** Jank above this share of frames is worth a finding (Android vitals counts a session slow above 25 %). */
const JANK_PERCENT = 10;

/** What a device without the measure is told it lacks. */
const MEASURE_NAME: Record<Capability, string> = {
  cpu: 'CPU',
  memory: 'memory',
  frames: 'frames',
  resetFrames: 'frames',
  vitals: 'the device state',
  launch: 'launch time',
  cpuProfile: 'a CPU profile',
  heap: 'a heap dump',
  frameTrace: 'a frame trace',
  buildType: 'the build type',
  attachProbe: 'through a frame probe',
  threads: 'per-thread CPU',
  network: 'network bytes',
  energy: 'energy',
  exits: 'crash and ANR exits',
  size: 'app size',
  heapProfile: 'a heap profile',
  hangs: 'hangs',
  xctMetrics: "XCTest's metrics",
};

const HEAP: Record<HeapReading['kind'], { store: string; label: string }> = {
  hprof: { store: 'heap-dump', label: 'heap dump' },
  memgraph: { store: 'heap-graph', label: 'memory graph (Xcode)' },
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return undefined;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2;
};
const kb = (n?: number) => (n === undefined ? '?' : `${(n / 1024).toFixed(1)} MB`);

/** A measure the platform may lack: its answer, or nothing when it says UNSUPPORTED. */
const unlessUnsupported = async <T>(p: Promise<T>): Promise<T | undefined> =>
  p.catch((e: unknown) => {
    if (e instanceof DeviceError && e.code === 'UNSUPPORTED') return undefined;
    return refused(e);
  });

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

/** The device's measure, or a refusal that names what it lacks. */
function measure<K extends Capability>(s: Session, k: K): NonNullable<MeasureSource[K]> {
  const source = s.device.measure;
  const f = source?.[k] as ((...a: unknown[]) => unknown) | undefined;
  if (!f) throw new ToolError(`${s.device.serial} cannot measure ${MEASURE_NAME[k]}`);
  return f.bind(source) as NonNullable<MeasureSource[K]>;
}

const virtual = (s: Session) => (s.device.virtual ?? s.device.measure?.virtual) === true;

/**
 * A run's records, with the context each number is judged by; read after the measured window, so it does not
 * disturb it. Whatever measures next (a flow's journey, step by step) keeps its numbers here and perf_compare
 * reads them like any other: name the scenario and the metrics.
 */
export async function keepRun(
  ctx: ServerContext,
  s: Session,
  app: string,
  scenario: string,
  source: string,
  raw: string,
  metrics: Metric[],
  compile?: string,
) {
  const m = s.device.measure;
  const vitals = (await m?.vitals?.().catch(() => undefined))?.value;
  const h = s.device.hello;
  const records = recordsOf(
    {
      run: newId('run'),
      app,
      scenario,
      source,
      raw,
      device: {
        serial: s.device.serial,
        platform: s.device.platform,
        model: h?.model ?? 'unknown',
        os: h?.osVersion ?? 'unknown',
        virtual: virtual(s),
      },
      build: (await m?.buildType?.(app).catch(() => undefined)) ?? 'unknown',
      ...(compile && { compile }),
      load: {
        host: loadavg(),
        hostCpus: cpus().length,
        ...(vitals?.load && { device: vitals.load }),
        ...(vitals?.cpuPressure !== undefined && { devicePressure: vitals.cpuPressure }),
      },
      ...(vitals?.thermalStatus !== undefined && { thermal: vitals.thermalStatus }),
      ...(vitals?.batteryTempC !== undefined && { batteryTempC: vitals.batteryTempC }),
      tool: h?.agentVersion ?? 'unknown',
      at: new Date().toISOString(),
    },
    metrics,
  );
  await saveRun(ctx.measurementsDir, records);
  return records[0]?.noise ?? [];
}

export function perfOps(ctx: ServerContext): Op[] {
  const appOf = (s: Session, app?: string) => {
    const pkg = checkApp(ctx.policy, app ?? s.appId ?? '');
    if (!pkg) throw new ToolError('give app (or select one with use_device)');
    return pkg;
  };
  const virtualNote = (s: Session) =>
    virtual(s) ? ' (virtual device: relative, compare only with the same kind of device)' : '';
  const save = async (kind: string, m: Measured<unknown>[], value: unknown) =>
    store(ctx.measurementsDir, kind, value, m.map((x) => `## ${x.at}\n${x.raw}`).join('\n\n'));
  const keep = (
    s: Session,
    app: string,
    scenario: string,
    source: string,
    raw: string,
    metrics: Metric[],
    compile?: string,
  ) => keepRun(ctx, s, app, scenario, source, raw, metrics, compile);
  const noisy = (noise: string[]) => (noise.length ? [`noise: ${noise.join(', ')}`] : []);
  const withProbe = async (s: Session, pkg: string, probe?: boolean) => {
    if (probe) await measure(s, 'attachProbe')(pkg).catch(refused);
  };
  /** Four swipes after `waitMs`, for a measure that records during a scroll. */
  const scroller = async (s: Session, direction: 'up' | 'down', waitMs: number) => {
    const h = s.device.hello!;
    const size = (await s.current()).window ?? { w: h.screen.w, h: h.screen.h };
    return async () => {
      await pause(waitMs).catch(refused);
      for (let i = 0; i < 4; i++) {
        const { from, to } = swipeLine(size, { direction, distance: size.h * 0.4 });
        await s.device.swipe(from, to, 300, { settle: false });
      }
    };
  };

  return [
    defineOp({
      name: 'perf_snapshot',
      title: 'Performance snapshot',
      description:
        "The app's CPU now (2 s), its memory, its frames since the last measure and the device's state (load, heat). The measurement id and the raw output are kept.",
      input: z
        .object({
          app: App,
          cpuWindowMs: z.number().int().min(500).max(10_000).default(2_000),
          also: z
            .array(z.enum(['threads', 'network', 'energy', 'exits', 'size']))
            .optional()
            .describe(
              'threads: each thread and its time above 90 %; network: bytes in the window; energy: a model's estimate (Android: resets the battery history); exits: crashes and ANRs; size: on disk',
            ),
          scenario: Scenario,
        })
        .strict(),
      output: SnapshotOut,
      annotations: READ,
      needs: 'cpu',
      run: async ({ app, cpuWindowMs, also = [], scenario }) => {
        const s = await ctx.session();
        s.appPid = undefined;
        const pkg = appOf(s, app);
        const readCpu = measure(s, 'cpu');
        const readMemory = measure(s, 'memory');
        const cpu = await readCpu(pkg, cpuWindowMs).catch(refused);
        const mem = await readMemory(pkg).catch(refused);
        const source = s.device.measure!;
        const frames = source.frames && (await unlessUnsupported(source.frames(pkg)));
        const vitals = await source.vitals?.().catch(refused);
        const lacking: string[] = [];
        const extra = async <T>(what: string, get: (() => Promise<T>) | undefined) => {
          if (!also.includes(what as (typeof also)[number])) return undefined;
          const got = get && (await unlessUnsupported(get()));
          if (!got) lacking.push(what);
          return got;
        };
        const threads = await extra(
          'threads',
          source.threads && (() => source.threads!(pkg, cpuWindowMs)),
        );
        const network = await extra(
          'network',
          source.network && (() => source.network!(pkg, cpuWindowMs)),
        );
        const energy = await extra(
          'energy',
          source.energy && (() => source.energy!(pkg, cpuWindowMs)),
        );
        const exits = await extra('exits', source.exits && (() => source.exits!(pkg)));
        const size = await extra('size', source.size && (() => source.size!(pkg)));
        const saved = await save(
          'snapshot',
          [cpu, mem, frames, vitals, threads, network, energy, exits, size].filter(
            (x): x is Measured<never> => !!x,
          ),
          {
            cpu: cpu.value,
            memory: mem.value,
            ...(frames && { frames: frames.value }),
            ...(vitals && { vitals: vitals.value }),
            ...(threads && { threads: threads.value }),
            ...(network && { network: network.value }),
            ...(energy && { energy: energy.value }),
            ...(exits && { exits: exits.value }),
            ...(size && { size: size.value }),
          },
        );
        const noise = await keep(s, pkg, scenario ?? 'idle', 'perf_snapshot', saved.txt, [
          { kind: 'cpu.percent', unit: 'percent', samples: [cpu.value.percent] },
          { kind: 'memory.kb', unit: 'kb', samples: [mem.value.kb] },
          ...(threads
            ? [
                {
                  kind: 'threads.over90_ms',
                  unit: 'ms' as const,
                  samples: [threads.value.worstOver90Ms],
                },
              ]
            : []),
          ...(network
            ? [
                {
                  kind: 'network.rx_bytes',
                  unit: 'bytes' as const,
                  samples: [network.value.rxBytes],
                },
                {
                  kind: 'network.tx_bytes',
                  unit: 'bytes' as const,
                  samples: [network.value.txBytes],
                },
              ]
            : []),
          ...(energy?.value.mah !== undefined
            ? [{ kind: 'energy.mah', unit: 'mah' as const, samples: [energy.value.mah] }]
            : []),
          ...(exits
            ? [
                { kind: 'exits.crashes', unit: 'count' as const, samples: [exits.value.crashes] },
                { kind: 'exits.anrs', unit: 'count' as const, samples: [exits.value.anrs] },
              ]
            : []),
          ...(size
            ? [{ kind: 'size.bytes', unit: 'bytes' as const, samples: [size.value.bytes] }]
            : []),
        ]);
        const m = mem.value;
        const f = frames?.value;
        const v = vitals?.value;
        return reply(
          [
            `measurement ${saved.id}${virtualNote(s)}`,
            `CPU: ${cpu.value.percent}% (of one core, ${cpu.value.windowMs} ms)`,
            m.kind === 'pss'
              ? `memory: PSS ${kb(m.kb)}, Java ${kb(m.javaHeapKb)}, native ${kb(m.nativeHeapKb)}, graphics ${kb(m.graphicsKb)}`
              : `memory: physical footprint ${kb(m.kb)}${m.peakKb !== undefined ? ` (peak ${kb(m.peakKb)})` : ''}`,
            ...(f
              ? [
                  `frames (since the last reset): ${f.totalFrames}, janky ${f.jankyPercent}%, frozen ${f.frozenFrames}${f.p95Ms !== undefined ? `, p95 ${f.p95Ms} ms` : ''}${f.fewFrames ? ' (few frames: the share means little)' : ''}`,
                  ...(f.frames?.worstWindow
                    ? [
                        `worst second: ${f.frames.worstWindow.slow} missed of ${f.frames.worstWindow.frames} frames, mean ${f.frames.worstWindow.avgMs} ms`,
                      ]
                    : []),
                ]
              : ['no frame measure on a simulator without the probe']),
            ...(f?.limits ? [f.limits] : []),
            ...(v
              ? [
                  `device: load ${v.load?.join(' ') ?? '?'}, CPU pressure ${v.cpuPressure ?? '?'}, thermal ${v.thermalStatus ?? '?'}`,
                ]
              : []),
            ...(threads
              ? [
                  `threads: ${threads.value.threads
                    .slice(0, 5)
                    .map(
                      (t) =>
                        `${t.name} ${t.percent}%${t.over90Ms ? ` (${t.over90Ms} ms above 90 %)` : ''}`,
                    )
                    .join(', ')}`,
                ]
              : []),
            ...(network
              ? [
                  `network: ${network.value.rxBytes} bytes in, ${network.value.txBytes} out${network.value.note ? ` (${network.value.note})` : ''}`,
                ]
              : []),
            ...(energy ? [`energy: ${energy.value.mah ?? '?'} mAh; ${energy.value.note}`] : []),
            ...(exits
              ? [
                  `exits: ${exits.value.crashes} crashes, ${exits.value.anrs} ANRs of ${exits.value.total}`,
                ]
              : []),
            ...(size ? [`size: ${(size.value.bytes / 1048576).toFixed(1)} MB`] : []),
            ...(lacking.length ? [`not measurable here: ${lacking.join(', ')}`] : []),
            ...noisy(noise),
            `raw output: ${saved.txt}`,
          ].join('\n'),
          {
            id: saved.id,
            raw: saved.txt,
            virtualDevice: virtual(s),
            cpuPercent: cpu.value.percent,
            memoryKb: m.kb,
            memoryKind: m.kind,
            ...(m.peakKb !== undefined && { peakKb: m.peakKb }),
            ...(m.javaHeapKb !== undefined && { javaHeapKb: m.javaHeapKb }),
            ...(m.nativeHeapKb !== undefined && { nativeHeapKb: m.nativeHeapKb }),
            ...(f && {
              frames: {
                total: f.totalFrames,
                jankyPercent: f.jankyPercent,
                frozen: f.frozenFrames,
                ...(f.p95Ms !== undefined && { p95Ms: f.p95Ms }),
              },
            }),
            ...(v?.load && { deviceLoad: v.load }),
            ...(threads && { threads: threads.value.threads.slice(0, 10) }),
            ...(network && { rxBytes: network.value.rxBytes, txBytes: network.value.txBytes }),
            ...(energy?.value.mah !== undefined && { energyMah: energy.value.mah }),
            ...(exits && { crashes: exits.value.crashes, anrs: exits.value.anrs }),
            ...(size && { sizeBytes: size.value.bytes }),
            ...(lacking.length && { lacking }),
            noise,
          },
        );
      },
    }),
    defineOp({
      name: 'perf_scroll',
      title: 'Scroll performance',
      description:
        'Measure frames and memory while scrolling a list: each round resets the frames, swipes `swipes` times, and reads frames and memory once the list stops. Up or down only.',
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
          await new Promise((x) => setTimeout(x, 1_500));
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
        const jank = median(counted.map((x) => x.jankyPercent));
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
    }),
    defineOp({
      name: 'perf_launch',
      title: 'Launch time',
      description:
        "The app's launch time: cold (stopped first), warm (process alive, activity new) or hot (back from the background); a warm-up, then `repeats` launches, median. Android: `compile` sets the compile state (reset afterwards), `trace` adds a Perfetto start trace naming why it was slow. The app restarts.",
      input: z
        .object({
          app: App,
          mode: z.enum(['cold', 'warm', 'hot']).default('cold'),
          repeats: z.number().int().min(1).max(30).default(5),
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
        await withProbe(s, pkg, probe);
        const m = await measure(s, 'launch')(pkg, {
          mode,
          repeats,
          ...(compile && { compile }),
          ...(trace && { trace }),
        }).catch(refused);
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
            },
            {
              kind: 'launch.ttfd_ms',
              unit: 'ms',
              samples: samples.flatMap((x) =>
                x.fullyDrawnMs === undefined ? [] : [x.fullyDrawnMs],
              ),
            },
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
            excessive: med !== undefined && med >= limit,
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
    }),
    defineOp({
      name: 'perf_profile',
      title: 'CPU profile',
      description:
        "Where the app's CPU time goes: sampling for `seconds` (the app must be debuggable or profileable), the functions that take the most. Optionally scrolls during the recording.",
      input: z
        .object({
          app: App,
          seconds: z.number().int().min(1).max(30).default(3),
          scroll: z.enum(['up', 'down']).optional(),
        })
        .strict(),
      output: ProfileOut,
      annotations: READ,
      needs: 'cpuProfile',
      run: async ({ app, seconds, scroll }) => {
        const s = await ctx.session();
        s.appPid = undefined;
        const pkg = appOf(s, app);
        const profile = measure(s, 'cpuProfile');
        const during = scroll ? await scroller(s, scroll, 300) : undefined;
        const m = await profile(pkg, seconds * 1000, during).catch(refused);
        if (scroll) s.acted();
        const saved = await save('cpu-profile', [m], m.value);
        return reply(
          [
            `measurement ${saved.id}${virtualNote(s)}`,
            `${m.value.samples} samples, ${m.value.durationMs} ms; the most time:`,
            ...m.value.top.slice(0, 10).map((e) => `%${e.percent} ${e.symbol}`),
            ...(m.value.appTop?.length
              ? [
                  "the app's own functions (with what they call):",
                  ...m.value.appTop.slice(0, 10).map((e) => `%${e.percent} ${e.symbol}`),
                ]
              : []),
            `raw output: ${saved.txt}`,
          ].join('\n'),
          {
            id: saved.id,
            raw: saved.txt,
            virtualDevice: virtual(s),
            samples: m.value.samples,
            top: m.value.top.map((e) => ({ percent: e.percent, symbol: e.symbol })),
            ...(m.value.appTop && {
              appTop: m.value.appTop.map((e) => ({ percent: e.percent, symbol: e.symbol })),
            }),
          },
        );
      },
    }),
    defineOp({
      name: 'perf_heap',
      title: 'Heap dump',
      description:
        "The app's heap into a file on this machine (Android: Java HPROF, opened with a memory analyser; iOS simulator: an Xcode memory graph and the leak count). For a suspected leak, after perf_scroll. Android `profile`: a Perfetto java_hprof or heapprofd trace, top classes or sites, for a debuggable or profileable build.",
      input: z
        .object({
          app: App,
          profile: z.enum(['java_hprof', 'heapprofd']).optional(),
          seconds: z.number().int().min(1).max(60).default(5),
        })
        .strict(),
      output: HeapOut,
      annotations: READ,
      needs: 'heap',
      run: async ({ app, profile, seconds }) => {
        const s = await ctx.session();
        s.appPid = undefined;
        const pkg = appOf(s, app);
        if (profile) {
          const m = await measure(s, 'heapProfile')(pkg, profile, seconds).catch(refused);
          const v = m.value;
          const saved = await save('heap-profile', [m], v);
          await keep(s, pkg, `heap-${profile}`, 'perf_heap', saved.txt, [
            { kind: 'heap.bytes', unit: 'bytes', samples: [v.totalBytes] },
          ]);
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
        const m = await dump(pkg, ctx.measurementsDir).catch(refused);
        const v = m.value;
        const saved = await save(HEAP[v.kind].store, [m], v);
        if (v.leaks !== undefined)
          await keep(s, pkg, 'heap', 'perf_heap', saved.txt, [
            { kind: 'heap.leaks', unit: 'count', samples: [v.leaks] },
          ]);
        return reply(
          `measurement ${saved.id}\n${HEAP[v.kind].label}: ${v.file} (${(v.bytes / 1048576).toFixed(1)} MB)${v.leaks !== undefined ? `; ${v.leaks} leaks, ${v.leakedBytes} bytes` : ''}`,
          { id: saved.id, file: v.file, bytes: v.bytes },
        );
      },
    }),
    defineOp({
      name: 'perf_trace',
      title: 'Frame trace',
      description:
        "Record frames (Android 12+: each frame's time and why it was late; iPhone: animation hitches, their ratio and causes; iOS simulator with `probe`: main-thread pacing). Optionally scrolls during the recording. `what`: hangs (iPhone), or XCTest's own hitch or launch metric. The trace is kept for perf_query.",
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
          const noise = await keep(
            s,
            pkg,
            name,
            'xctrace Time Profiler potential-hangs',
            saved.txt,
            [
              { kind: 'hangs.count', unit: 'count', samples: [v.hangs] },
              { kind: 'hangs.worst_ms', unit: 'ms', samples: [v.worstMs] },
            ],
          );
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
          ]);
          return reply(
            [
              `measurement ${saved.id}${virtualNote(s)}`,
              `${v.frames} frames in ${v.durationMs} ms; ${v.missed} missed (${v.missedPercent}%); interval p50 ${v.p50Ms} ms, p95 ${v.p95Ms} ms, worst ${v.worstMs} ms`,
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
          ]);
          const causes = Object.entries(v.causes)
            .map(([c, k]) => `${k}× ${c}`)
            .join('; ');
          return reply(
            [
              `measurement ${saved.id}${virtualNote(s)}`,
              `${v.frames} frames; ${v.hitches} hitches of the app, ${v.hitchMs} ms in all, worst ${v.worstMs} ms; hitch ratio ${v.hitchRatio} ms/s`,
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
            `frame time p50 ${v.p50Ms} ms, p95 ${v.p95Ms} ms, worst ${v.worstMs} ms`,
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
    }),
    defineOp({
      name: 'perf_compare',
      title: 'Compare with the baseline',
      description:
        'The newest measured runs against the baseline and budgets in .appdyno/perf/; a change counts only when statistically and practically significant. `action`: compare; budget (budgets only); baseline (adds the newest run to the baseline, `replace` starts it over). No device needed.',
      input: z
        .object({
          action: z.enum(['compare', 'budget', 'baseline']).default('compare'),
          app: z.string().max(200).optional(),
          scenario: Scenario,
          deviceClass: z.string().max(200).optional(),
          last: z.number().int().min(1).max(20).default(1).describe('newest runs to pool'),
          replace: z.boolean().optional(),
          format: z.enum(['text', 'json', 'junit']).default('text'),
        })
        .strict(),
      output: CompareOut,
      annotations: READ,
      run: async ({ action, app, scenario, deviceClass, last, replace, format }) => {
        const dir = ctx.measurementsDir;
        const project = ctx.perfDir;
        const keys = await runKeys(dir, {
          ...(app && { app }),
          ...(scenario && { scenario }),
          ...(deviceClass && { deviceClass }),
        });
        if (keys.length === 0)
          throw new ToolError('no measured runs: run a perf_ operation first', 'NOT_FOUND');
        if (action === 'baseline') {
          const files = await Promise.all(
            keys.map(async (k) => {
              const [newest] = await latestRuns(dir, k);
              return {
                noise: newest?.[0]?.noise ?? [],
                file: await saveBaseline(
                  project,
                  addToBaseline(k, await loadBaseline(project, k), newest ?? [], replace),
                ),
              };
            }),
          );
          const loud = files.flatMap((f) => f.noise);
          return reply(
            [
              ...files.map((f) => `baseline: ${f.file}`),
              ...(loud.length ? [`measured with noise: ${[...new Set(loud)].join(', ')}`] : []),
            ].join('\n'),
            { failed: false, exitCode: 0, reports: [], baselines: files.map((f) => f.file) },
          );
        }
        const rules = await loadBudgets(project);
        const reports: KeyReport[] = await Promise.all(
          keys.map(async (k) => {
            const r = reportKey(
              k,
              await latestRuns(dir, k, last),
              await loadBaseline(project, k),
              rules,
            );
            return action === 'budget' ? { ...r, comparisons: [] } : r;
          }),
        );
        const code = exitCode(reports);
        const out =
          format === 'json'
            ? toJson(reports)
            : format === 'junit'
              ? toJUnit(reports)
              : toText(reports);
        return reply(out, { failed: code !== 0, exitCode: code, reports });
      },
    }),
    defineOp({
      name: 'perf_query',
      title: 'Query a kept trace',
      description:
        'A bounded table from a kept trace, no new recording: Perfetto (.pftrace): read-only SQL; Instruments (.trace): a table digested to its top rows (`table`; none lists the tables).',
      input: z
        .object({
          trace: z.string().max(1000).describe('the path a perf_ answer gave'),
          sql: z.string().max(10_000).optional(),
          table: z.string().max(200).optional(),
          limit: z.number().int().min(1).max(500).default(50),
        })
        .strict(),
      output: QueryOut,
      annotations: READ,
      run: async ({ trace, sql, table, limit }) => {
        const path = resolve(trace);
        const inside = [join(stateDir(), 'traces'), ctx.measurementsDir].some((d) => {
          const r = relative(d, path);
          return r !== '' && !r.startsWith('..') && !isAbsolute(r);
        });
        if (!inside) throw new ToolError(`not a kept trace: ${trace}`, 'POLICY_DENIED');
        let digest: TraceDigest | undefined;
        for (const p of ctx.providers) {
          digest = await p
            .queryTrace?.(path, { ...(sql && { sql }), ...(table && { table }), limit })
            .catch(refused);
          if (digest) break;
        }
        if (!digest) throw new ToolError(`no driver reads this trace: ${trace}`, 'UNSUPPORTED');
        return reply(
          [
            digest.columns.join(' | '),
            ...digest.rows.map((r) => r.join(' | ')),
            ...(digest.dropped ? [`(${digest.dropped} more rows left out)`] : []),
            `from: ${digest.source}`,
          ].join('\n'),
          { columns: digest.columns, rows: digest.rows, dropped: digest.dropped, trace: path },
        );
      },
    }),
  ];
}
