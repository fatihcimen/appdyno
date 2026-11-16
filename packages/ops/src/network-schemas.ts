import { z } from 'zod';

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
        id: z.number().int().optional(),
        how: z.string().optional(),
        rule: z.string().optional(),
        to: z.string().optional(),
      }),
    )
    .optional(),
  dropped: z.number().int().optional(),
  source: z.string().optional(),
  bodies: z.string().optional(),
  note: z.string().optional(),
  saved: z.string().optional(),
  /** One request whole, as its lines. */
  detail: z.array(z.string()).optional(),
});
