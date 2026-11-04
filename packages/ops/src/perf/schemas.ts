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
  crashes: z.number().optional(),
  anrs: z.number().optional(),
  userAnrs: z.number().optional(),
  sizeBytes: z.number().optional(),
  lacking: z.array(z.string()).optional(),
});

export const ScrollOut = z.object({
  ...Measurement,
  relaunched: z.boolean().optional(),
  rounds: z.array(
    z.object({
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
  excessive: z.boolean(),
  fullyDrawnMedianMs: z.number().optional(),
  compile: z.string().optional(),
  tracePath: z.string().optional(),
  reasons: z.array(z.string()).optional(),
  findings: z.array(z.string()).optional(),
});

export const TraceOut = z.object({
  ...Measurement,
  relaunched: z.boolean().optional(),
  frames: z.number(),
  /** Android. */
  appDeadlineMissed: z.number().optional(),
  appJankPercent: z.number().optional(),
  jankyPercent: z.number().optional(),
  p50Ms: z.number().optional(),
  p95Ms: z.number().optional(),
  worstMs: z.number(),
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
  failed: z.boolean(),
  exitCode: z.number(),
  reports: z.array(z.record(z.string(), z.unknown())),
  baselines: z.array(z.string()).optional(),
  file: z.string().optional(),
});

export const QueryOut = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  dropped: z.number(),
  trace: z.string(),
});
