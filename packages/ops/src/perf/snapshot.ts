import type { AnonMemory, Capability, EnergyReading, Measured } from '@appdyno/core';
import { ramTier, vitalsCall, type Metric } from '@appdyno/perf';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { holdingCondition } from '../settings.js';
import { SnapshotOut } from './schemas.js';
import type { Session } from '../session.js';
import { defineOp, READ, reply } from '../tool.js';
import { perfTools, App, Scenario, unlessUnsupported, kb } from './shared.js';
import { frameVitals, playLine } from './vitals.js';

/** A device's energy in the unit it has it in: a charge, a count of energy, or a score. */
const ENERGY_KINDS = [
  { field: 'mah', kind: 'energy.mah', unit: 'mah', says: 'mAh' },
  { field: 'mj', kind: 'energy.mj', unit: 'mj', says: 'mJ' },
  { field: 'impact', kind: 'energy.impact', unit: 'ratio', says: 'power impact' },
] as const;

const energyMetrics = (v: EnergyReading): Metric[] =>
  ENERGY_KINDS.flatMap(({ field, kind, unit }) =>
    v[field] === undefined
      ? []
      : [{ kind, unit, samples: [v[field]], ...(v.modelled && { modelled: true }) }],
  );

const energyText = (v: EnergyReading) =>
  `energy${v.modelled ? ' (a model)' : ''}: ${ENERGY_KINDS.flatMap(({ field, says }) =>
    v[field] === undefined ? [] : [`${v[field]} ${says}`],
  ).join(', ')}; ${v.note}`;

type Asked = {
  s: Session;
  pkg: string;
  windowMs: number;
  batteryMs: number;
  measure: ReturnType<typeof perfTools>['measure'];
};

/** The device's read of this, if it has one. */
const reads = <K extends Capability>(k: K, a: Asked) =>
  a.s.device.measure?.[k] && a.measure(a.s, k);

type Answered = Partial<z.infer<typeof SnapshotOut>>;

type Got = {
  measured: Measured<unknown>;
  metrics: Metric[];
  line: string;
  data: Answered;
};

/** One thing `also` can ask for: how it is read, then what is kept of it, said of it and answered. */
const extra =
  <T>(x: {
    read: (a: Asked) => Promise<Measured<T>> | undefined;
    metrics: (v: T) => Metric[];
    line: (v: T) => string;
    data: (v: T) => Answered;
  }) =>
  async (a: Asked): Promise<Got | undefined> => {
    const read = x.read(a);
    const m = read && (await unlessUnsupported(read));
    return (
      m && {
        measured: m,
        metrics: x.metrics(m.value),
        line: x.line(m.value),
        data: x.data(m.value),
      }
    );
  };

/** A tier and a state in the kind: the limit it is judged by depends on both. */
const anonMetrics = (v: AnonMemory): Metric[] => [
  {
    kind: `memory.anon_swap.${v.state}.${ramTier(v.ramMb) ?? 'other_'}gb_kb`,
    unit: 'kb',
    samples: [v.kb],
  },
  {
    kind: `memory.bitmap.${v.state}_kb`,
    unit: 'kb',
    samples: v.bitmapKb === undefined ? [] : [v.bitmapKb],
  },
];

/** What Play's table says of each, and that it says nothing where it has no limit for this state or this RAM. */
const anonLines = (v: AnonMemory) => {
  const judged = anonMetrics(v).flatMap((m) =>
    m.samples.flatMap((value) =>
      vitalsCall({ kind: m.kind, value, device: { platform: 'android' } })
        ? [playLine(m.kind, value)]
        : [],
    ),
  );
  return judged.length
    ? judged
    : [`Play: no limit for a ${v.state} process with ${v.ramMb} MB of RAM`];
};

const EXTRAS = {
  threads: extra({
    read: (a) => reads('threads', a)?.(a.pkg, a.windowMs),
    metrics: (v) => [{ kind: 'threads.over90_ms', unit: 'ms', samples: [v.worstOver90Ms] }],
    line: (v) =>
      `threads: ${v.threads
        .slice(0, 5)
        .map((t) => `${t.name} ${t.percent}%${t.over90Ms ? ` (${t.over90Ms} ms above 90 %)` : ''}`)
        .join(', ')}`,
    data: (v) => ({ threads: v.threads.slice(0, 10) }),
  }),
  network: extra({
    read: (a) => reads('network', a)?.(a.pkg, a.windowMs),
    metrics: (v) => [
      { kind: 'network.rx_bytes', unit: 'bytes', samples: [v.rxBytes] },
      { kind: 'network.tx_bytes', unit: 'bytes', samples: [v.txBytes] },
    ],
    line: (v) => `network: ${v.rxBytes} bytes in, ${v.txBytes} out${v.note ? ` (${v.note})` : ''}`,
    data: (v) => ({ rxBytes: v.rxBytes, txBytes: v.txBytes }),
  }),
  energy: extra({
    read: (a) => {
      const read = reads('energy', a);
      if (!read) return undefined;
      const now = () => read(a.pkg, a.windowMs);
      // Android reads it told it runs on battery; no other platform has this condition
      return a.s.device.platform === 'android' ? holdingCondition(a.s, 'battery', now) : now();
    },
    metrics: energyMetrics,
    line: energyText,
    data: (v) => ({
      ...(v.mah !== undefined && { energyMah: v.mah }),
      ...(v.mj !== undefined && { energyMj: v.mj }),
      ...(v.impact !== undefined && { energyImpact: v.impact }),
      energyModelled: v.modelled === true,
    }),
  }),
  anonMemory: extra({
    read: (a) => reads('anonMemory', a)?.(a.pkg),
    metrics: (v) => anonMetrics(v),
    line: (v) =>
      [
        `anon RSS and swap: ${kb(v.kb)} (anon ${kb(v.rssAnonKb)}, swap ${kb(v.swapKb)}), ${v.state}, process state ${v.processState}; bitmaps ${v.bitmapKb === undefined ? 'not listed by this Android' : kb(v.bitmapKb)}; RAM ${v.ramMb} MB`,
        ...anonLines(v),
      ].join('\n'),
    data: (v) => ({
      anonSwapKb: v.kb,
      rssAnonKb: v.rssAnonKb,
      swapKb: v.swapKb,
      processState: v.state,
      ...(v.bitmapKb !== undefined && { bitmapKb: v.bitmapKb }),
    }),
  }),
  startInfo: extra({
    read: (a) => reads('startInfo', a)?.(a.pkg),
    metrics: (v) =>
      Object.entries(v.newest.phases).map(([phase, ms]) => ({
        kind: `launch.phase.${phase}_ms` as const,
        unit: 'ms' as const,
        samples: [ms],
      })),
    line: (v) => {
      const { reason, startType, wasForceStopped, phases } = v.newest;
      const counts = new Map<string, number>();
      for (const s of v.starts) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
      const reasons = [...counts].map(([r, n]) => `${r} ${n}`).join(', ');
      return [
        `last start: ${startType}, ${reason}${wasForceStopped ? ', after a force stop' : ''}${
          Object.keys(phases).length
            ? `; ${Object.entries(phases)
                .map(([p, ms]) => `${p.replaceAll('_', ' ')} ${ms} ms`)
                .join(', ')}`
            : ''
        }`,
        `the ${v.starts.length} starts the system keeps: ${reasons}`,
      ].join('\n');
    },
    data: (v) => ({
      startReason: v.newest.reason,
      startType: v.newest.startType,
      startPhases: v.newest.phases,
      startReasons: v.starts.map((s) => s.reason),
    }),
  }),
  surface: extra({
    read: (a) => reads('surfaceFrames', a)?.(a.pkg),
    metrics: (v) =>
      v.frames === 0
        ? []
        : [
            { kind: 'surface.p95_ms', unit: 'ms', samples: [v.p95Ms] },
            { kind: 'surface.slow_34_percent', unit: 'percent', samples: [v.slow34Percent] },
            { kind: 'surface.slow_50_percent', unit: 'percent', samples: [v.slow50Percent] },
          ],
    line: (v) =>
      v.frames === 0
        ? 'no SurfaceView of the app holds frames: what it draws through the View toolkit is in frames above'
        : [
            `surface: ${v.frames} frames, ${v.fps} a second, p50 ${v.p50Ms} ms, p95 ${v.p95Ms} ms, worst ${v.worstMs} ms, on a ${v.refreshMs} ms display${v.drawing ? '' : ', and it is not drawing now: these are its last'}`,
            playLine('surface.slow_50_percent', v.slow50Percent),
            playLine('surface.slow_34_percent', v.slow34Percent),
          ].join('\n'),
    data: (v) => ({ surface: v }),
  }),
  battery: extra({
    read: (a) => reads('battery', a)?.(a.pkg, a.batteryMs),
    metrics: (v) => [
      { kind: 'wakelocks.ms', unit: 'ms', samples: [v.wakeLockMs] },
      { kind: 'wakelocks.percent', unit: 'percent', samples: [v.wakeLockPercent] },
      { kind: 'wakelocks.longest_ms', unit: 'ms', samples: [v.longestLockMs] },
      { kind: 'wakeups.count', unit: 'count', samples: [v.wakeups] },
      { kind: 'wakeups.per_hour', unit: 'count', samples: [v.wakeupsPerHour] },
      { kind: 'jobs.count', unit: 'count', samples: [v.jobs] },
    ],
    line: (v) =>
      [
        `battery, ${v.windowMs} ms: wake locks ${v.wakeLockMs} ms${v.wakeLocks.length ? ` (${v.wakeLocks.map((l) => `${l.tag} ${l.ms} ms${l.exempt ? `, ${l.exempt}: exempt` : ''}`).join('; ')})` : ''}; ${v.wakeups} wakeups of ${v.alarms} alarms${v.alarmTags.length ? ` (${v.alarmTags.map((t) => `${t.tag} ${t.wakeups}`).join('; ')})` : ''}; ${v.jobs} jobs; ${v.note}`,
        playLine('wakelocks.percent', v.wakeLockPercent),
        playLine('wakelocks.longest_ms', v.longestLockMs),
        playLine('wakeups.per_hour', v.wakeupsPerHour),
      ].join('\n'),
    data: (v) => ({
      wakeLocks: v.wakeLocks,
      wakeLockMs: v.wakeLockMs,
      longestLockMs: v.longestLockMs,
      wakeups: v.wakeups,
      wakeupsPerHour: v.wakeupsPerHour,
      alarms: v.alarms,
      jobs: v.jobs,
    }),
  }),
  exits: extra({
    read: (a) => reads('exits', a)?.(a.pkg),
    metrics: (v) => [
      { kind: 'exits.crashes', unit: 'count', samples: [v.crashes] },
      { kind: 'exits.anrs', unit: 'count', samples: v.anrs === undefined ? [] : [v.anrs] },
      {
        kind: 'exits.user_anrs',
        unit: 'count',
        samples: v.userAnrs === undefined ? [] : [v.userAnrs],
      },
    ],
    line: (v) =>
      [
        `exits: ${v.crashes} crashes of ${v.total}${v.anrs === undefined ? '' : `; ${v.anrs} ANRs filed`}`,
        ...(v.userAnrs === undefined ? [] : [playLine('exits.user_anrs', v.userAnrs)]),
      ].join('\n'),
    data: (v) => ({
      crashes: v.crashes,
      anrs: v.anrs,
      ...(v.userAnrs !== undefined && { userAnrs: v.userAnrs }),
    }),
  }),
  size: extra({
    read: (a) => reads('size', a)?.(a.pkg),
    metrics: (v) => [{ kind: 'size.bytes', unit: 'bytes', samples: [v.bytes] }],
    line: (v) => `size: ${(v.bytes / 1048576).toFixed(1)} MB`,
    data: (v) => ({ sizeBytes: v.bytes }),
  }),
};

type ExtraName = keyof typeof EXTRAS;

/** All of them, in the order an answer gives them. */
export const EXTRA_NAMES = Object.keys(EXTRAS) as [ExtraName, ...ExtraName[]];

export function perfSnapshotOp(ctx: ServerContext) {
  const { measure, appOf, virtualNote, save, keep, noisy } = perfTools(ctx);
  return defineOp({
    name: 'perf_snapshot',
    title: 'Performance snapshot',
    description:
      "The app's CPU now, memory, frames since the last measure and the device's load and heat.",
    input: z
      .object({
        app: App,
        cpuWindowMs: z.number().int().min(500).max(10_000).default(2_000),
        also: z
          .array(z.enum(EXTRA_NAMES))
          .optional()
          .describe(
            'threads; network; energy (says if a model); anonMemory: by process state, bitmaps; surface: a SurfaceView or game; startInfo: why it last started; battery: wake locks, wakeups, jobs; exits; size',
          ),
        batteryWindowMs: z.number().int().min(1_000).max(600_000).default(30_000),
        scenario: Scenario,
      })
      .strict(),
    output: SnapshotOut,
    annotations: READ,
    run: async ({ app, cpuWindowMs, batteryWindowMs, also = [], scenario }) => {
      const s = await ctx.session();
      s.appPid = undefined;
      const pkg = appOf(s, app);
      const readCpu = measure(s, 'cpu');
      const readMemory = measure(s, 'memory');
      const cpu = await readCpu(pkg, cpuWindowMs);
      const mem = await readMemory(pkg);
      const source = s.device.measure!;
      const frames = source.frames && (await unlessUnsupported(source.frames(pkg)));
      const vitals = await source.vitals?.();
      const asked = { s, pkg, windowMs: cpuWindowMs, batteryMs: batteryWindowMs, measure };
      const lacking: ExtraName[] = [];
      const got: (Got & { name: ExtraName })[] = [];
      for (const name of EXTRA_NAMES) {
        if (!also.includes(name)) continue;
        const x = await EXTRAS[name](asked);
        if (x) got.push({ ...x, name });
        else lacking.push(name);
      }
      const saved = await save(
        'snapshot',
        [cpu, mem, frames, vitals, ...got.map((g) => g.measured)].flatMap((x) => x ?? []),
        {
          cpu: cpu.value,
          memory: mem.value,
          ...(frames && { frames: frames.value }),
          ...(vitals && { vitals: vitals.value }),
          ...Object.fromEntries(got.map((g) => [g.name, g.measured.value])),
        },
      );
      const f = frames?.value;
      const play = frameVitals(f?.histogram ? [f.histogram] : []);
      const noise = await keep(s, pkg, scenario ?? 'idle', 'perf_snapshot', saved.txt, [
        { kind: 'cpu.percent', unit: 'percent', samples: [cpu.value.percent] },
        { kind: 'memory.kb', unit: 'kb', samples: [mem.value.kb] },
        ...play.metrics,
        ...got.flatMap((g) => g.metrics),
      ]);
      const m = mem.value;
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
            : [
                s.device.virtual
                  ? 'no frame measure on a simulator without the probe'
                  : 'no frame counter on a phone: perf_scroll and perf_trace record its hitches',
              ]),
          ...(f?.limits ? [f.limits] : []),
          ...play.lines,
          ...(v
            ? [
                `device: load ${v.load?.join(' ') ?? '?'}${v.parkedKernelThreads ? ` (${v.parkedKernelThreads} of it kernel threads asleep, no CPU)` : ''}, CPU pressure ${v.cpuPressure ?? '?'}, thermal ${v.thermalStatus ?? '?'}`,
              ]
            : []),
          ...got.map((g) => g.line),
          ...(lacking.length ? [`not measurable here: ${lacking.join(', ')}`] : []),
          ...noisy(noise),
          `raw output: ${saved.txt}`,
        ].join('\n'),
        {
          id: saved.id,
          raw: saved.txt,
          virtualDevice: s.device.virtual,
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
              ...play.shares,
            },
          }),
          ...(v?.load && { deviceLoad: v.load }),
          ...got.reduce<Answered>((all, g) => ({ ...all, ...g.data }), {}),
          ...(lacking.length && { lacking }),
          noise,
        },
      );
    },
  });
}
