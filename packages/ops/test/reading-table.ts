import type { Kind } from '@appdyno/perf';
import {
  anon,
  battery,
  BATTERY_UNREAD,
  energy,
  ENERGY_NONE,
  exits,
  FEW,
  FEW_FRAMES,
  hangs,
  heapDump,
  heapProfile,
  hitches,
  launch,
  MANY,
  memoryGone,
  network,
  NETWORK_UNREAD,
  NO_EARLIER_RUN,
  NO_FRAMES,
  NO_TIME,
  OTHER_STATE,
  noRecording,
  plainSnapshot,
  probe,
  profiled,
  refuses,
  says,
  scroll,
  shares,
  snapshot,
  started,
  surface,
  SURFACE_UNREAD,
  scrolledSurface,
  threads,
  timeline,
  xct,
  type Asked,
} from './reading-cases.js';

/**
 * What one reading of each kept kind means, and what is kept where it was not really measured: never settled, too few,
 * unread, from before this run. Every row goes through its tool, so what it says of a kind is what a run keeps. A number
 * is only worth what the case that did not measure it does: a new kind says both, or this does not pass.
 */
export type Reading = {
  means: string;
  /** What a reading reads, from each tool that keeps the kind. */
  value: number;
  reads: Asked[];
  /** Each way it was not measured: a run keeps none of it, and a tool that stops keeps nothing at all. */
  notRead: Record<string, Asked>;
};

/** Those a run names itself: each row is one of them, and `journey.test.ts` drives the last, which takes a flow. */
export const FAMILIES = ['launch.phase.', 'xct.', 'memory.anon_swap.', 'memory.bitmap.'];

export const READINGS = {
  'launch.ttid_ms': {
    means: 'the time to a first frame the platform reports, the median of the starts',
    value: 600,
    reads: [launch({}, {})],
    notRead: {
      'the platform reported no time': launch({}, NO_TIME),
      'the platform timed another state than asked': launch({}, OTHER_STATE),
    },
  },
  'launch.first_frame_ms': {
    means: "a tool's own time to the first frame",
    value: 600,
    reads: [launch({}, { until: 'the first frame' })],
    notRead: { 'nothing timed it': launch({}, { until: 'the first frame', ...NO_TIME }) },
  },
  'launch.until_ms': {
    means: "a tool's own time until what it says it waited for",
    value: 600,
    reads: [launch({}, { until: 'the first screen is read' })],
    notRead: { 'nothing timed it': launch({}, { until: 'the first screen is read', ...NO_TIME }) },
  },
  'launch.ttfd_ms': {
    means: 'the time until the app itself said it had drawn all it means to',
    value: 900,
    reads: [launch({}, { samples: [{ totalMs: 600, fullyDrawnMs: 900 }] })],
    notRead: { 'the app never said': launch({}, {}) },
  },
  'launch.worst_cold_ms': {
    means: "the longest cold start of the run, as Play keeps a day's",
    value: 610,
    reads: [launch({ mode: 'cold' }, {})],
    notRead: {
      'no start was timed': launch({ mode: 'cold' }, NO_TIME),
      'no start was cold': launch({ mode: 'cold' }, OTHER_STATE),
      "it was a tool's own time, which Play knows nothing of": launch(
        { mode: 'cold' },
        { until: 'the first screen is read' },
      ),
    },
  },
  'launch.worst_warm_ms': {
    means: 'the longest warm start of the run',
    value: 610,
    reads: [launch({ mode: 'warm' }, {})],
    notRead: { 'no start was timed': launch({ mode: 'warm' }, NO_TIME) },
  },
  'launch.worst_hot_ms': {
    means: 'the longest hot start of the run',
    value: 610,
    reads: [launch({ mode: 'hot' }, {})],
    notRead: { 'no start was timed': launch({ mode: 'hot' }, NO_TIME) },
  },
  'launch.without_profile_ms': {
    means: 'a start with the baseline profile taken away',
    value: 910,
    reads: [profiled([900, 910, 920], [700, 710, 720])],
    notRead: { 'no such start was timed': profiled([], [700]) },
  },
  'launch.with_profile_ms': {
    means: 'a start with the baseline profile compiled in',
    value: 710,
    reads: [profiled([900, 910, 920], [700, 710, 720])],
    notRead: { 'no such start was timed': profiled([900], []) },
  },
  'launch.phase.fork_ms': {
    means: "a part of the start of this run, by the system's own marks",
    value: 76.9,
    reads: [snapshot('startInfo', 'startInfo', started(true))],
    notRead: {
      'the start the system holds is from before this run': snapshot(
        'startInfo',
        'startInfo',
        started(false),
      ),
    },
  },
  'surface.p95_ms': {
    means: "the time between a surface's presents, by whole refreshes",
    value: 33,
    reads: [surface(), scrolledSurface()],
    notRead: SURFACE_UNREAD,
  },
  'surface.slow_34_percent': {
    means: 'the share of its frames that came 34 ms or more after the last',
    value: 3,
    reads: [surface(), scrolledSurface()],
    notRead: SURFACE_UNREAD,
  },
  'surface.slow_50_percent': {
    means: 'the share of its frames that came 50 ms or more after the last',
    value: 1,
    reads: [surface(), scrolledSurface()],
    notRead: SURFACE_UNREAD,
  },
  'frames.jank_percent': {
    means: 'the middle round of a scroll by its share of janky frames',
    value: 8,
    reads: [scroll(MANY)],
    notRead: { 'too few frames were drawn': scroll(FEW) },
  },
  'frames.app_jank_percent': {
    means: 'the share of frames late by the app itself',
    value: 8,
    reads: [timeline(MANY)],
    notRead: { ...NO_FRAMES, ...FEW_FRAMES },
  },
  'frames.slow_percent': {
    means: "the share of frames over 16 ms, Play's slow frames",
    value: 5,
    reads: [shares(MANY, 6, 0)],
    notRead: { 'too few frames were drawn': shares(FEW, 1, 0) },
  },
  'frames.frozen_percent': {
    means: "the share of frames of 700 ms or more, Play's frozen frames",
    value: 0.2,
    reads: [shares(2_000, 6, 4)],
    notRead: { 'too few frames were drawn for a share so small': shares(MANY, 6, 1) },
  },
  'frames.p95_ms': {
    means: 'a frame time only one in twenty passed',
    value: 18,
    reads: [scroll(MANY)],
    notRead: {
      'too few frames were drawn': scroll(FEW),
      'a recording held no frames': timeline(0),
      'a recording held too few': timeline(FEW),
    },
  },
  'frames.overrun_p95_ms': {
    means: 'how far past its deadline a late frame ran',
    value: 3,
    reads: [timeline(MANY)],
    notRead: { ...FEW_FRAMES, 'the trace lacks the slices': timeline(MANY, { stats: undefined }) },
  },
  'frames.cpu_p95_ms': {
    means: "the CPU time of a frame's work",
    value: 7,
    reads: [timeline(MANY)],
    notRead: {
      ...FEW_FRAMES,
      'its column held nothing': timeline(MANY, {
        stats: { frames: MANY, overrunP95Ms: 3, overrunWorstMs: 5 },
      }),
    },
  },
  'hitches.count': {
    means: "the app's animation hitches, not the system's",
    value: 4,
    reads: [hitches()],
    notRead: { 'nothing moved on the screen': noRecording('CHECK_FAILED') },
  },
  'hitches.ratio': {
    means: 'the ms of hitches a second',
    value: 40,
    reads: [hitches()],
    notRead: { 'nothing moved on the screen': noRecording('CHECK_FAILED') },
  },
  'hitches.worst_ms': {
    means: 'the longest hitch',
    value: 90,
    reads: [hitches()],
    notRead: { 'nothing moved on the screen': noRecording('CHECK_FAILED') },
  },
  'probe.missed_percent': {
    means: 'the share of intervals on the main thread past a vsync and a half',
    value: 5,
    reads: [probe(MANY)],
    notRead: { 'no frames were drawn': probe(0), 'too few frames were drawn': probe(FEW) },
  },
  'probe.p95_ms': {
    means: 'an interval between frames only one in twenty passed',
    value: 33,
    reads: [probe(MANY)],
    notRead: { 'no frames were drawn': probe(0), 'too few frames were drawn': probe(FEW) },
  },
  'probe.stall_worst_ms': {
    means: 'the longest stall of the main thread the probe saw',
    value: 120,
    reads: [probe(MANY)],
    notRead: { 'no frames were drawn': probe(0) },
  },
  'frames.frozen': {
    means: 'how many frames took 700 ms or more',
    value: 1,
    reads: [timeline(MANY), probe(MANY), hitches()],
    notRead: { ...NO_FRAMES, 'a scroll drew none': scroll(0, { frozenFrames: 0 }) },
  },
  'stalls.worst_ms': {
    means: "the longest frame of the app's process, or hold of its main thread",
    value: 45,
    reads: [timeline(MANY)],
    notRead: NO_FRAMES,
  },
  'hangs.count': {
    means: 'how many times the main thread stopped for over 250 ms',
    value: 1,
    reads: [hangs(says({ hangs: 1, worstMs: 500, totalMs: 500, tracePath: '/s' }))],
    notRead: { 'the trace holds no table of hangs': hangs(refuses('UNSUPPORTED'), 'UNSUPPORTED') },
  },
  'hangs.worst_ms': {
    means: 'the longest of those',
    value: 500,
    reads: [hangs(says({ hangs: 1, worstMs: 500, totalMs: 500, tracePath: '/s' }))],
    notRead: { 'the trace holds no table of hangs': hangs(refuses('UNSUPPORTED'), 'UNSUPPORTED') },
  },
  'memory.kb': {
    means: 'what the app held when it was read: PSS, or a phone footprint',
    value: 500,
    reads: [plainSnapshot({ memory: says({ kb: 500, kind: 'pss' }) })],
    notRead: { 'the app is not running': memoryGone(plainSnapshot()) },
  },
  'memory.end_kb': {
    means: 'what it held at the end of each round of a scroll',
    value: 500,
    reads: [
      {
        ...scroll(MANY),
        measures: { ...scroll(MANY).measures, memory: says({ kb: 500, kind: 'pss' }) },
      },
    ],
    notRead: { 'the app is not running': memoryGone(scroll(MANY)) },
  },
  'memory.anon_swap.foreground.6gb_kb': {
    means: "RssAnon and swap, what Play's limit for this state and this much RAM is on",
    value: 2_000,
    reads: [snapshot('anonMemory', 'anonMemory', anon())],
    notRead: {
      'the device cannot read it': {
        ...plainSnapshot({ anonMemory: refuses('UNSUPPORTED') }),
        args: { also: ['anonMemory'], cpuWindowMs: 500 },
      },
    },
  },
  'memory.bitmap.foreground_kb': {
    means: 'its bitmaps, malloced and not',
    value: 300,
    reads: [snapshot('anonMemory', 'anonMemory', anon(300))],
    notRead: { 'this Android lists no such row': snapshot('anonMemory', 'anonMemory', anon()) },
  },
  'heap.bytes': {
    means: 'the bytes a heap profile found held',
    value: 1_000,
    reads: [heapProfile(says({ kind: 'java_hprof', tracePath: '/h', top: [], totalBytes: 1_000 }))],
    notRead: { 'it recorded nothing': heapProfile(refuses('UNSUPPORTED'), 'UNSUPPORTED') },
  },
  'heap.leaks': {
    means: 'the leaks a tool counted',
    value: 3,
    reads: [heapDump({ file: '/h', bytes: 100, kind: 'memgraph', leaks: 3 })],
    notRead: {
      'a heap dump has no count of leaks': heapDump({ file: '/h', bytes: 100, kind: 'hprof' }),
    },
  },
  'cpu.percent': {
    means: "the app's share of a core over the window",
    value: 12.5,
    reads: [plainSnapshot()],
    notRead: {
      'the app is not running': plainSnapshot(
        { cpu: refuses('APP_NOT_RUNNING') },
        'APP_NOT_RUNNING',
      ),
    },
  },
  'threads.over90_ms': {
    means: 'the longest a thread stayed above nine tenths of a core',
    value: 120,
    reads: [
      threads({
        threads: [{ tid: 1, name: 'main', percent: 95, over90Ms: 120 }],
        worstOver90Ms: 120,
      }),
    ],
    notRead: {
      'there were not two reads to compare': threads({ reads: 1, threads: [], worstOver90Ms: 0 }),
    },
  },
  'network.rx_bytes': {
    means: 'what the app received over the window',
    value: 4_000,
    reads: [network(4_000, 300)],
    notRead: NETWORK_UNREAD,
  },
  'network.tx_bytes': {
    means: 'what the app sent over the window',
    value: 300,
    reads: [network(4_000, 300)],
    notRead: NETWORK_UNREAD,
  },
  'energy.mah': {
    means: "the charge Android's own model gave the app",
    value: 1.5,
    reads: [energy({ mah: 1.5, modelled: true })],
    notRead: ENERGY_NONE,
  },
  'energy.mj': {
    means: 'millijoules, counted or modelled, and marked which',
    value: 40,
    reads: [energy({ mj: 40 })],
    notRead: ENERGY_NONE,
  },
  'energy.impact': {
    means: "Instruments' relative score, no unit of energy",
    value: 3.5,
    reads: [energy({ impact: 3.5 })],
    notRead: ENERGY_NONE,
  },
  'wakelocks.ms': {
    means: 'the time of this window a lock Play counts was held',
    value: 600,
    reads: [battery()],
    notRead: BATTERY_UNREAD,
  },
  'wakelocks.percent': {
    means: 'that share of the window',
    value: 2,
    reads: [battery()],
    notRead: BATTERY_UNREAD,
  },
  'wakelocks.longest_ms': {
    means: 'how long one has been held at all, before the window too',
    value: 700,
    reads: [battery()],
    notRead: BATTERY_UNREAD,
  },
  'wakeups.count': {
    means: 'the wakeups of its alarms in the window',
    value: 12,
    reads: [battery()],
    notRead: {
      ...BATTERY_UNREAD,
      'the count fell between its reads': battery({ wakeups: -3, wakeupsPerHour: -360 }),
    },
  },
  'wakeups.per_hour': {
    means: 'those by the hour',
    value: 1_440,
    reads: [battery()],
    notRead: {
      ...BATTERY_UNREAD,
      'the count fell between its reads': battery({ wakeups: -3, wakeupsPerHour: -360 }),
    },
  },
  'jobs.count': {
    means: 'the jobs that ran in the window',
    value: 3,
    reads: [battery()],
    notRead: BATTERY_UNREAD,
  },
  'exits.crashes': {
    means: 'the crashes since the last run of this key, and no stock of them',
    value: 1,
    reads: [exits()],
    notRead: NO_EARLIER_RUN,
  },
  'exits.anrs': {
    means: 'the ANRs since then',
    value: 2,
    reads: [exits()],
    notRead: {
      ...NO_EARLIER_RUN,
      'the dropbox went unread': exits({ run: { crashes: 1, total: 1 } }),
    },
  },
  'exits.user_anrs': {
    means: 'those a person waited through, which Play counts',
    value: 1,
    reads: [exits()],
    notRead: {
      ...NO_EARLIER_RUN,
      'the dropbox went unread': exits({ run: { crashes: 1, total: 1 } }),
    },
  },
  'size.bytes': {
    means: 'the bytes of the installed apks',
    value: 4_096,
    reads: [snapshot('size', 'size', { bytes: 4_096, parts: {} })],
    notRead: {
      'the device cannot read it': {
        ...plainSnapshot({ size: refuses('UNSUPPORTED') }),
        args: { also: ['size'], cpuWindowMs: 500 },
      },
    },
  },
  'xct.ratio': {
    means: "XCTest's own metric, each iteration a sample",
    value: 2,
    reads: [xct({ ratio: [1, 2, 3] })],
    notRead: { 'it read none': xct({ ratio: [] }) },
  },
} satisfies Partial<Record<Kind, Reading>>;
