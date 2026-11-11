import { z } from 'zod';

const Kept = { id: z.string(), raw: z.string(), virtualDevice: z.boolean() };

const Measurement = { ...Kept, noise: z.array(z.string()) };

const PlayShares = {
  /** Android: the share of frames over 16 ms, and of 700 ms or over from 1,000 frames: what Android vitals judges. */
  slowPercent: z.number().optional(),
  frozenPercent: z.number().optional(),
};

export const SnapshotOut = z.object({
  ...Measurement,
  surface: z
    .object({
      layer: z.string(),
      refreshMs: z.number(),
      frames: z.number().int(),
      fps: z.number(),
      p50Ms: z.number(),
      p95Ms: z.number(),
      worstMs: z.number(),
      slow34Percent: z.number(),
      slow50Percent: z.number(),
      drawing: z.boolean(),
    })
    .optional(),
  startReason: z.string().optional(),
  startType: z.string().optional(),
  startPhases: z.record(z.string(), z.number()).optional(),
  startReasons: z.array(z.string()).optional(),
  anonSwapKb: z.number().optional(),
  rssAnonKb: z.number().optional(),
  swapKb: z.number().optional(),
  processState: z.string().optional(),
  bitmapKb: z.number().optional(),
  wakeLocks: z
    .array(
      z.object({
        tag: z.string(),
        ms: z.number(),
        longestMs: z.number(),
        count: z.number(),
        exempt: z.string().optional(),
      }),
    )
    .optional(),
  wakeLockMs: z.number().optional(),
  longestLockMs: z.number().optional(),
  wakeups: z.number().optional(),
  wakeupsPerHour: z.number().optional(),
  alarms: z.number().optional(),
  jobs: z.number().optional(),
  cpuPercent: z.number(),
  cpuBehind: z.string().optional(),
  memoryKb: z.number(),
  /** What memoryKb counts: Android's PSS, or Apple's physical footprint. */
  memoryKind: z.enum(['pss', 'footprint']),
  peakKb: z.number().optional(),
  javaHeapKb: z.number().optional(),
  nativeHeapKb: z.number().optional(),
  frames: z
    .object({
      ...PlayShares,
      total: z.number(),
      jankyPercent: z.number(),
      frozen: z.number(),
      p95Ms: z.number().optional(),
    })
    .optional(),
  deviceLoad: z.array(z.number()).optional(),
  threads: z
    .array(
      z.object({ tid: z.number(), name: z.string(), percent: z.number(), over90Ms: z.number() }),
    )
    .optional(),
  rxBytes: z.number().optional(),
  txBytes: z.number().optional(),
  energyMah: z.number().optional(),
  energyMj: z.number().optional(),
  energyImpact: z.number().optional(),
  energyModelled: z.boolean().optional(),
  /** Since the run before this one, by the system's own stamps; none with no such run. */
  crashes: z.number().optional(),
  anrs: z.number().optional(),
  userAnrs: z.number().optional(),
  /** All the system still holds, of any age: no reading of this run. */
  exitsHeld: z
    .object({
      crashes: z.number(),
      anrs: z.number().optional(),
      userAnrs: z.number().optional(),
      total: z.number(),
      atLeast: z.boolean().optional(),
    })
    .optional(),
  sizeBytes: z.number().optional(),
  lacking: z.array(z.string()).optional(),
});

export const ScrollOut = z.object({
  ...Measurement,
  rounds: z.array(
    z.object({
      rewound: z.boolean().optional(),
      frames: z.number(),
      jankyPercent: z.number(),
      frozen: z.number(),
      p95Ms: z.number().optional(),
      memStartKb: z.number(),
      memEndKb: z.number(),
      activities: z.number().optional(),
      appContexts: z.number().optional(),
      viewRootImpl: z.number().optional(),
    }),
  ),
  jankMedianPercent: z.number().optional(),
  frozen: z.number(),
  ...PlayShares,
  memGrowth: z.number().optional(),
  findings: z.array(z.string()),
});

export const LaunchOut = z.object({
  ...Measurement,
  mode: z.enum(['cold', 'warm', 'hot']),
  samples: z.array(z.object({ totalMs: z.number().optional(), state: z.string().optional() })),
  medianMs: z.number().optional(),
  /** Past the store's limit, where one rates a start: absent where none does. */
  excessive: z.boolean().optional(),
  fullyDrawnMedianMs: z.number().optional(),
  compile: z.string().optional(),
  tracePath: z.string().optional(),
  reasons: z.array(z.string()).optional(),
  findings: z.array(z.string()).optional(),
  baselineProfile: z
    .object({
      present: z.boolean(),
      state: z.string().optional(),
      applied: z.boolean(),
      rules: z.number().int().optional(),
      withoutMs: z.array(z.number()),
      withMs: z.array(z.number()),
      verdict: z.enum(['worth-it', 'no-gain', 'slower']).optional(),
    })
    .optional(),
  /** The baseline `baseline` kept these runs in. */
  baselineFile: z.string().optional(),
  /** What the run is kept as, and the call that goes on from it: a run alone is no baseline. */
  next: z.string().optional(),
});

export const TraceOut = z.object({
  ...Measurement,
  /** What a recording counted: hangs and XCTest's own metrics count no frames, and answer none. */
  frames: z.number().optional(),
  /** Android. */
  appDeadlineMissed: z.number().optional(),
  appJankPercent: z.number().optional(),
  jankyPercent: z.number().optional(),
  slowFrames: z.number().optional(),
  slowBecause: z.string().optional(),
  p50Ms: z.number().optional(),
  p95Ms: z.number().optional(),
  worstMs: z.number().optional(),
  /** Android: the longest hold of the main thread by Choreographer's own line in the app's log, which may be in no frame. */
  heldMs: z.number().optional(),
  frozen: z.number().optional(),
  /** iOS: the app's animation hitches, their time and ratio (ms per second), and the trace. */
  hitches: z.number().optional(),
  hitchMs: z.number().optional(),
  hitchRatio: z.number().optional(),
  tracePath: z.string().optional(),
  /** Simulator probe. */
  missed: z.number().optional(),
  stalls: z.number().optional(),
  limits: z.string().optional(),
  hangs: z.number().optional(),
  hangCauses: z
    .array(
      z.object({
        ms: z.number(),
        kind: z.enum(['busy', 'blocked']),
        cpuPercent: z.number(),
        function: z.string().optional(),
      }),
    )
    .optional(),
  metrics: z.record(z.string(), z.array(z.number())).optional(),
});

export const ProfileOut = z.object({
  ...Kept,
  samples: z.number(),
  top: z.array(z.object({ percent: z.number(), symbol: z.string() })),
  /** iOS: the app's own functions by busy inclusive time. */
  appTop: z.array(z.object({ percent: z.number(), symbol: z.string() })).optional(),
});

export const HeapOut = z.object({
  id: z.string(),
  file: z.string(),
  bytes: z.number(),
  leaks: z.number().optional(),
  top: z.array(z.object({ name: z.string(), bytes: z.number(), count: z.number() })).optional(),
});

export const CompareOut = z.object({
  prune: z
    .object({
      limitBytes: z.number(),
      beforeBytes: z.number(),
      afterBytes: z.number(),
      removed: z.number(),
      over: z.boolean(),
      stopped: z.string().optional(),
    })
    .optional(),
  functions: z
    .array(
      z.object({
        symbol: z.string(),
        beforeMs: z.number(),
        afterMs: z.number(),
        changeMs: z.number(),
      }),
    )
    .optional(),
  failed: z.boolean(),
  exitCode: z.number(),
  reports: z.array(z.record(z.string(), z.unknown())),
  /** What the gate says of each run, and why: `why`. */
  answers: z.array(z.record(z.string(), z.unknown())).optional(),
  baselines: z.array(z.string()).optional(),
  references: z.array(z.string()).optional(),
  file: z.string().optional(),
});

export const QueryOut = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  dropped: z.number(),
  trace: z.string(),
});
