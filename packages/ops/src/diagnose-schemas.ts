import { z } from 'zod';

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
