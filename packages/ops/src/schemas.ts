import { z } from 'zod';

/**
 * The structured part of every tool's answer: a short summary a program can read (what was done, how
 * the screen changed, the measurement's numbers). The screen's elements stay in the text, so a client
 * that shows both to a model does not pay for the screen twice.
 */
const Changes = z.object({
  added: z.number().int(),
  removed: z.number().int(),
  changed: z.number().int(),
});

export const ActionOut = z.object({
  done: z.string(),
  /** How the screen after the action is given in the text. */
  screen: z.enum(['none', 'unchanged', 'diff', 'full']),
  changes: Changes.optional(),
  elements: z.number().int().optional(),
  foreground: z.string().optional(),
  settled: z.boolean().optional(),
  /** From the action to the settled screen, as the device timed it. */
  settleMs: z.number().optional(),
  /** Whether the screen differs from before the action, layout or text; absent when unknown. */
  changed: z.boolean().optional(),
  /** What is known to keep the screen busy, when it did not settle. */
  busy: z.array(z.string()).optional(),
  /** The app's process ended during the action. */
  appDied: z.object({ reason: z.string(), file: z.string().optional() }).optional(),
  /** `keyboard status`. */
  open: z.boolean().optional(),
  /** `alert` with no answer. */
  alert: z
    .object({
      texts: z.array(z.string()),
      buttons: z.array(z.object({ label: z.string(), x: z.number(), y: z.number() })),
    })
    .optional(),
  warnings: z.array(z.string()),
  code: z.string().optional(),
  hint: z.string().optional(),
});
export type ActionOut = z.infer<typeof ActionOut>;

export const ScreenOut = z.object({
  elements: z.number().int(),
  foreground: z.string().optional(),
  warnings: z.array(z.string()),
});

export const FindOut = z.object({
  matches: z.array(
    z.object({
      ref: z.string(),
      role: z.string(),
      label: z.string(),
      id: z.string().optional(),
      x: z.number(),
      y: z.number(),
      enabled: z.boolean(),
      checked: z.boolean(),
      focused: z.boolean(),
      value: z.string().optional(),
      bounds: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    }),
  ),
});

export const WaitOut = z.object({
  met: z.boolean(),
  gone: z.boolean(),
  found: z.object({ ref: z.string(), label: z.string() }).optional(),
  screen: z.enum(['none', 'unchanged', 'diff', 'full']),
});

export const DevicesOut = z.object({
  devices: z.array(
    z.object({
      serial: z.string(),
      state: z.string(),
      model: z.string().optional(),
      allowed: z.boolean(),
      selected: z.boolean(),
      heldBy: z.object({ pid: z.number(), tool: z.string(), since: z.string() }).optional(),
    }),
  ),
});

export const DeviceOut = z.object({
  serial: z.string(),
  model: z.string(),
  os: z.string(),
  sdk: z.number().int().optional(),
  screen: z.object({ w: z.number(), h: z.number(), density: z.number(), rotation: z.number() }),
  agentVersion: z.string(),
  capabilities: z.array(z.string()).optional(),
  foreground: z.string().optional(),
  agentStarted: z.boolean().optional(),
  app: z.string().optional(),
});

export const ScreenshotOut = z.object({
  width: z.number().int(),
  height: z.number().int(),
  scale: z.number().optional(),
});

export const DoneOut = z.object({ done: z.string() });

export const FlowOut = z.object({
  done: z.string(),
  steps: z.number().int().optional(),
  flagged: z.array(z.string()).optional(),
  timings: z
    .array(
      z.object({
        n: z.number().int(),
        line: z.number().int(),
        step: z.string(),
        ms: z.number(),
        settledMs: z.number().optional(),
        settled: z.boolean().optional(),
        changed: z.boolean().optional(),
        warnings: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

export const AppOut = z.object({
  done: z.string(),
  apps: z
    .array(
      z.object({ id: z.string(), name: z.string().optional(), version: z.string().optional() }),
    )
    .optional(),
  state: z.enum(['not_installed', 'stopped', 'running', 'foreground']).optional(),
});

export const VirtualOut = z.object({
  done: z.string(),
  devices: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        state: z.enum(['running', 'stopped']),
        serial: z.string().optional(),
        startedHere: z.boolean(),
      }),
    )
    .optional(),
  serial: z.string().optional(),
});

export const SettingOut = z.object({
  done: z.string(),
  value: z.string().optional(),
  changed: z.record(z.string(), z.string()).optional(),
  notRestored: z.array(z.string()).optional(),
});

export const AuditOut = z.object({
  engine: z.string(),
  truncated: z.boolean(),
  issues: z.array(
    z.object({
      type: z.string(),
      rule: z.string(),
      message: z.string(),
      label: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    }),
  ),
});

export const LogsOut = z.object({
  lines: z.number(),
  dropped: z.number(),
  source: z.string(),
  note: z.string().optional(),
});

export const CrashesOut = z.object({
  reports: z.array(
    z.object({
      at: z.string(),
      reason: z.string(),
      detail: z.string().optional(),
      file: z.string().optional(),
    }),
  ),
  source: z.string(),
  note: z.string().optional(),
});

const Measurement = { id: z.string(), raw: z.string(), virtualDevice: z.boolean() };

export const SnapshotOut = z.object({
  ...Measurement,
  cpuPercent: z.number(),
  memoryKb: z.number(),
  /** What memoryKb counts: Android's PSS, or Apple's physical footprint. */
  memoryKind: z.enum(['pss', 'footprint']),
  peakKb: z.number().optional(),
  javaHeapKb: z.number().optional(),
  nativeHeapKb: z.number().optional(),
  frames: z
    .object({
      total: z.number(),
      jankyPercent: z.number(),
      frozen: z.number(),
      p95Ms: z.number().optional(),
    })
    .optional(),
  deviceLoad: z.array(z.number()).optional(),
});

export const ScrollOut = z.object({
  ...Measurement,
  rounds: z.array(
    z.object({
      frames: z.number(),
      jankyPercent: z.number(),
      frozen: z.number(),
      p95Ms: z.number().optional(),
      memStartKb: z.number(),
      memEndKb: z.number(),
    }),
  ),
  jankMedianPercent: z.number().optional(),
  frozen: z.number(),
  memGrowth: z.number().optional(),
  findings: z.array(z.string()),
});

export const LaunchOut = z.object({
  ...Measurement,
  mode: z.enum(['cold', 'warm']),
  samples: z.array(z.object({ totalMs: z.number().optional(), state: z.string().optional() })),
  medianMs: z.number().optional(),
  excessive: z.boolean(),
});

export const TraceOut = z.object({
  ...Measurement,
  frames: z.number(),
  /** Android. */
  appDeadlineMissed: z.number().optional(),
  appJankPercent: z.number().optional(),
  jankyPercent: z.number().optional(),
  p50Ms: z.number().optional(),
  p95Ms: z.number().optional(),
  worstMs: z.number(),
  /** iOS: the app's animation hitches, their time and ratio (ms per second), and the trace. */
  hitches: z.number().optional(),
  hitchMs: z.number().optional(),
  hitchRatio: z.number().optional(),
  tracePath: z.string().optional(),
});

export const ProfileOut = z.object({
  ...Measurement,
  samples: z.number(),
  top: z.array(z.object({ percent: z.number(), symbol: z.string() })),
  /** iOS: the app's own functions by busy inclusive time. */
  appTop: z.array(z.object({ percent: z.number(), symbol: z.string() })).optional(),
});

export const HeapOut = z.object({ id: z.string(), file: z.string(), bytes: z.number() });
