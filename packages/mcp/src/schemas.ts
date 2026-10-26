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
  warnings: z.array(z.string()),
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

const Measurement = { id: z.string(), raw: z.string(), virtualDevice: z.boolean() };

export const SnapshotOut = z.object({
  ...Measurement,
  cpuPercent: z.number(),
  /** Android. */
  pssKb: z.number().optional(),
  javaHeapKb: z.number().optional(),
  nativeHeapKb: z.number().optional(),
  /** iOS simulator: the app's physical footprint. */
  footprintKb: z.number().optional(),
  /** Android. */
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
  appDeadlineMissed: z.number(),
  appJankPercent: z.number(),
  jankyPercent: z.number(),
  p50Ms: z.number(),
  p95Ms: z.number(),
  worstMs: z.number(),
});

export const ProfileOut = z.object({
  ...Measurement,
  samples: z.number(),
  top: z.array(z.object({ percent: z.number(), symbol: z.string() })),
});

export const HeapOut = z.object({ id: z.string(), file: z.string(), bytes: z.number() });
