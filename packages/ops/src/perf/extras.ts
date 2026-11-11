import {
  MIN_FRAMES,
  type AnonMemory,
  type EnergyReading,
  type ExitCounts,
  type Measured,
  type NetworkReading,
} from '@appdyno/core';
import { playCall, ramTier, type Metric } from '@appdyno/perf';
import type { z } from 'zod';
import type { ServerContext } from '../context.js';
import { holdingCondition } from '../settings.js';
import type { SnapshotOut } from './schemas.js';
import type { Session } from '../session.js';
import { kb, lastRunAt, unlessUnsupported, type perfTools } from './shared.js';
import { lastStartSeen, startLine } from './starts.js';
import { playLine } from './vitals.js';

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

const wentBack = (v: NetworkReading) => v.rxBytes < 0 || v.txBytes < 0;

const exitWords = (c: ExitCounts) =>
  `${c.crashes} crashes of ${c.total}${c.anrs === undefined ? '' : `; ${c.anrs} ANRs filed`}`;

type Asked = {
  ctx: ServerContext;
  s: Session;
  pkg: string;
  scenario: string;
  windowMs: number;
  batteryMs: number;
  measure: ReturnType<typeof perfTools>['measure'];
};

export type Answered = Partial<z.infer<typeof SnapshotOut>>;

export type Got = {
  measured: Measured<unknown>;
  metrics: Metric[];
  line: string;
  data: Answered;
  startedNs?: number | undefined;
};

/** One thing `also` can ask for: how it is read, then what is kept of it, said of it and answered. */
const extra =
  <T>(x: {
    read: (a: Asked) => Promise<Measured<T>>;
    metrics: (v: T) => Metric[];
    line: (v: T) => string;
    data: (v: T) => Answered;
    startedNs?: (v: T) => number | undefined;
  }) =>
  async (a: Asked): Promise<Got | undefined> => {
    const m = await unlessUnsupported(x.read(a));
    return (
      m && {
        measured: m,
        metrics: x.metrics(m.value),
        line: x.line(m.value),
        data: x.data(m.value),
        startedNs: x.startedNs?.(m.value),
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
    m.samples.flatMap((value) => (playCall(m.kind, value) ? [playLine(m.kind, value)] : [])),
  );
  return judged.length
    ? judged
    : [`Play: no limit for a ${v.state} process with ${v.ramMb} MB of RAM`];
};

/** What perf_snapshot's `also` can read beside its CPU, memory and frames, each by its name. */
export const EXTRAS = {
  threads: extra({
    read: (a) => a.measure(a.s, 'threads')(a.pkg, a.windowMs),
    metrics: (v) =>
      v.threads.length
        ? [{ kind: 'threads.over90_ms', unit: 'ms', samples: [v.worstOver90Ms] }]
        : [],
    line: (v) =>
      v.threads.length
        ? `threads: ${v.threads
            .slice(0, 5)
            .map(
              (t) => `${t.name} ${t.percent}%${t.over90Ms ? ` (${t.over90Ms} ms above 90 %)` : ''}`,
            )
            .join(', ')}`
        : 'threads: no two reads to compare, so no reading',
    data: (v) => ({ threads: v.threads.slice(0, 10) }),
  }),
  network: extra({
    read: (a) => a.measure(a.s, 'network')(a.pkg, a.windowMs),
    metrics: (v) =>
      wentBack(v)
        ? []
        : [
            { kind: 'network.rx_bytes', unit: 'bytes', samples: [v.rxBytes] },
            { kind: 'network.tx_bytes', unit: 'bytes', samples: [v.txBytes] },
          ],
    line: (v) =>
      wentBack(v)
        ? 'network: the system aged out a count between the two reads, so no reading'
        : `network: ${v.rxBytes} bytes in, ${v.txBytes} out${v.note ? ` (${v.note})` : ''}`,
    data: (v) => (wentBack(v) ? {} : { rxBytes: v.rxBytes, txBytes: v.txBytes }),
  }),
  energy: extra({
    read: (a) => {
      const now = () => a.measure(a.s, 'energy')(a.pkg, a.windowMs);
      const held = a.s.device.measure.energyHolds;
      return held ? holdingCondition(a.s, held, now) : now();
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
    read: (a) => a.measure(a.s, 'anonMemory')(a.pkg),
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
    // the system keeps a start for as long as it likes: what is kept is one no run has seen
    read: async (a) =>
      a.measure(a.s, 'startInfo')(a.pkg, await lastStartSeen(a.ctx, a.s, a.pkg, a.scenario)),
    startedNs: (v) => v.newest.startedNs,
    metrics: (v) =>
      v.newestIsNew
        ? Object.entries(v.newest.phases).map(([phase, ms]) => ({
            kind: `launch.phase.${phase}_ms` as const,
            unit: 'ms' as const,
            samples: [ms],
          }))
        : [],
    line: startLine,
    data: (v) => ({
      startReason: v.newest.reason,
      startType: v.newest.startType,
      startPhases: v.newest.phases,
      startReasons: v.starts.map((s) => s.reason),
    }),
  }),
  surface: extra({
    read: (a) => a.measure(a.s, 'surfaceFrames')(a.pkg),
    // a surface keeps its last frames, whatever their age: one that stopped drawing says nothing of this run
    metrics: (v) =>
      !v.drawing || v.frames < MIN_FRAMES
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
            `surface: ${v.frames} frames, ${v.fps} a second, p50 ${v.p50Ms} ms, p95 ${v.p95Ms} ms, worst ${v.worstMs} ms, on a ${v.refreshMs} ms display${v.drawing ? '' : ', and it is not drawing now: these are its last, of any age, and none is kept'}`,
            playLine('surface.slow_50_percent', v.slow50Percent),
            playLine('surface.slow_34_percent', v.slow34Percent),
          ].join('\n'),
    data: (v) => ({ surface: v }),
  }),
  battery: extra({
    read: (a) => a.measure(a.s, 'battery')(a.pkg, a.batteryMs),
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
  // a snapshot is a moment: what happened in it is what happened since the run before it
  exits: extra({
    read: async (a) =>
      a.measure(a.s, 'exits')(a.pkg, await lastRunAt(a.ctx, a.s, a.pkg, a.scenario)),
    metrics: ({ run }) =>
      run
        ? [
            { kind: 'exits.crashes', unit: 'count', samples: [run.crashes] },
            {
              kind: 'exits.anrs',
              unit: 'count',
              samples: run.anrs === undefined ? [] : [run.anrs],
            },
            {
              kind: 'exits.user_anrs',
              unit: 'count',
              samples: run.userAnrs === undefined ? [] : [run.userAnrs],
            },
          ]
        : [],
    line: ({ run, held }) =>
      [
        run
          ? `exits since the last run: ${exitWords(run)}`
          : 'exits: no earlier run to count from, so this one keeps none',
        ...(run?.userAnrs === undefined ? [] : [playLine('exits.user_anrs', run.userAnrs)]),
        `the system holds ${held.atLeast ? 'at least ' : ''}${exitWords(held)}, of any age: no reading of this run`,
      ].join('\n'),
    data: ({ run, held }) => ({
      ...(run && {
        crashes: run.crashes,
        ...(run.anrs !== undefined && { anrs: run.anrs }),
        ...(run.userAnrs !== undefined && { userAnrs: run.userAnrs }),
      }),
      exitsHeld: held,
    }),
  }),
  size: extra({
    read: (a) => a.measure(a.s, 'size')(a.pkg),
    metrics: (v) => [{ kind: 'size.bytes', unit: 'bytes', samples: [v.bytes] }],
    line: (v) => `size: ${(v.bytes / 1048576).toFixed(1)} MB`,
    data: (v) => ({ sizeBytes: v.bytes }),
  }),
};

export type ExtraName = keyof typeof EXTRAS;

/** All of them, in the order an answer gives them. */
export const EXTRA_NAMES = Object.keys(EXTRAS) as [ExtraName, ...ExtraName[]];
