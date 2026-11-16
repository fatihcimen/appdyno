import { z } from 'zod';
import { VIA } from './network-capture.js';
import { MAX_RULES } from './network-rules.js';

const MAX_ENTRIES = 200;
const DEFAULT_ENTRIES = 50;
const ACTIONS = ['paths', 'start', 'read', 'stop', 'mock', 'throttle', 'check'] as const;

export const NetworkIn = z
  .object({
    action: z.enum(ACTIONS),
    via: z.enum(VIA).optional(),
    proxy: z.string().max(100).optional(),
    app: z.string().max(200).optional(),
    bodies: z.boolean().optional(),
    har: z.string().max(1_000).optional(),
    id: z.number().int().min(0).optional(),
    after: z.number().int().min(0).optional().describe('only requests after this id'),
    contains: z.string().max(200).optional(),
    method: z.string().max(10).optional(),
    status: z.string().max(6).optional().describe('404, 4xx, failed'),
    limit: z.number().int().min(1).max(MAX_ENTRIES).default(DEFAULT_ENTRIES),
    save: z.string().max(1_000).optional(),
    overwrite: z.boolean().optional(),
    rules: z
      .array(z.string().max(4_000))
      .max(MAX_RULES)
      .optional()
      .describe(
        'Each "host/path* [method=] [query=] [regex=] [has=] [when=]" then "status= body= (@file) type= header=", "fail=offline|timeout|reset" or "to=host", and delayMs= times= off. Replaces; [] clears; none lists',
      ),
    add: z.boolean().optional(),
    has: z.string().max(1_000).optional().describe('in its body: path=value or text'),
    timeoutMs: z.number().int().min(0).max(60_000).optional(),
    from: z.string().max(1_000).optional().describe('rules from a request id or a .har'),
    unmatched: z.enum(['pass', 'fail']).optional().describe('a request no rule takes'),
    strict: z.boolean().optional().describe('a 5xx or a failed request fails the action'),
    throttle: z
      .string()
      .max(100)
      .optional()
      .describe('full, slow, edge, 3g, lte, offline, bytes/s down, or "delayMs= down= up= loss="'),
  })
  .strict();

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
        code: z.number().int().optional(),
        id: z.number().int().optional(),
        how: z.string().optional(),
        rule: z.string().optional(),
        to: z.string().optional(),
        inFlight: z.boolean().optional(),
        timings: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])).optional(),
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
  rules: z
    .array(z.object({ rule: z.string(), hits: z.number().int(), off: z.boolean().optional() }))
    .optional(),
  throttle: z.string().optional(),
  /** The rules a `from` made, each as its line. */
  added: z.array(z.string()).optional(),
});
