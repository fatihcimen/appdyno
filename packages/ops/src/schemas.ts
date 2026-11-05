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

/** What a recorder or a capture needs to find its own again, from another process. */
export const Handle = z.record(z.string(), z.union([z.string(), z.number()]));

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
  /** `alert`: the label of the button it pressed. */
  answered: z.string().optional(),
  /** `keyboard dismiss`: it was open and closed. */
  closed: z.boolean().optional(),
  /** `scroll_to`: what it looked for is on the screen. */
  found: z.boolean().optional(),
  moving: z.boolean().optional(),
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
      /** What a person must do before it can be driven. */
      blocked: z.object({ need: z.string(), title: z.string(), fix: z.string() }).optional(),
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
  foreground: z.string().optional(),
  agentStarted: z.boolean().optional(),
  app: z.string().optional(),
});

export const ScreenshotOut = z.object({
  width: z.number().int(),
  height: z.number().int(),
  scale: z.number().optional(),
  warnings: z.array(z.string()),
  file: z.string().optional(),
});

export const DoneOut = z.object({ done: z.string() });

export const VisualOut = z.object({
  done: z.string(),
  file: z.string(),
  same: z.boolean().optional(),
  percent: z.number().optional(),
  differing: z.number().optional(),
});

export const ReactNativeOut = z.object({
  done: z.string(),
  targets: z.array(z.object({ id: z.string(), title: z.string().optional() })).optional(),
  lines: z.number().int().optional(),
  dropped: z.number().int().optional(),
});

export const WebOut = z.object({
  done: z.string().optional(),
  page: z.string().optional(),
  pages: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        url: z.string(),
        app: z.string().optional(),
        visible: z.boolean().optional(),
      }),
    )
    .optional(),
  elements: z
    .array(
      z.object({
        tag: z.string(),
        text: z.string(),
        role: z.string().optional(),
        selector: z.string().optional(),
        x: z.number(),
        y: z.number(),
      }),
    )
    .optional(),
});

export const NetworkOut = z.object({
  done: z.string().optional(),
  paths: z
    .array(
      z.object({
        via: z.string(),
        sees: z.string().optional(),
        refused: z.string().optional(),
      }),
    )
    .optional(),
  entries: z
    .array(
      z.object({
        at: z.string().optional(),
        method: z.string().optional(),
        url: z.string().optional(),
        status: z.number().optional(),
        ms: z.number().optional(),
        direction: z.string().optional(),
        host: z.string().optional(),
        packets: z.number().optional(),
        bytes: z.number().optional(),
        body: z.boolean().optional(),
        error: z.string().optional(),
      }),
    )
    .optional(),
  dropped: z.number().int().optional(),
  source: z.string().optional(),
  bodies: z.string().optional(),
  note: z.string().optional(),
});

export const ReportOut = z.object({
  done: z.string(),
  dir: z.string(),
  file: z.string().optional(),
  steps: z.number().int().optional(),
});

export const RecordOut = z.object({
  done: z.string(),
  files: z.array(z.string()),
  since: z.string().optional(),
  durationMs: z.number().optional(),
  frames: z.number().int().optional(),
  note: z.string().optional(),
});

export const MirrorOut = z.object({
  done: z.string(),
  mirrors: z.array(z.record(z.string(), z.unknown())),
});

export const HandOffOut = z.object({
  done: z.string(),
  by: z.enum(['person', 'screen', 'timeout']),
  waitedMs: z.number(),
});

export const FlowOut = z.object({
  done: z.string(),
  steps: z.number().int().optional(),
  flagged: z.array(z.string()).optional(),
  timings: z
    .array(
      z.object({
        n: z.number().int(),
        line: z.number().int(),
        file: z.string().optional(),
        step: z.string(),
        ms: z.number(),
        settledMs: z.number().optional(),
        actMs: z.number().optional(),
        settled: z.boolean().optional(),
        changed: z.boolean().optional(),
        warnings: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  /** `run` with `iterations`: what each step read, the median of the iterations. */
  journey: z
    .object({
      id: z.string(),
      raw: z.string(),
      scenario: z.string(),
      iterations: z.number().int(),
      totalMs: z.number(),
      steps: z.array(
        z.object({
          step: z.string(),
          ms: z.number(),
          framesP95Ms: z.number().optional(),
          framesWorstMs: z.number().optional(),
          memoryKb: z.number().optional(),
        }),
      ),
      note: z.string().optional(),
      noise: z.array(z.string()),
    })
    .optional(),
});

/** `launch` answers with the screen it brings, as an action does. */
export const AppOut = ActionOut.partial().extend({
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
      symbolicated: z.string().optional(),
    }),
  ),
  source: z.string(),
  note: z.string().optional(),
  exits: z
    .array(
      z.object({
        reason: z.string(),
        count: z.number().int(),
        newest: z.string(),
        memory: z.string().optional(),
      }),
    )
    .optional(),
});
