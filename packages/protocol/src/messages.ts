import { z } from 'zod';

/** Protocol major (breaking changes) and minor (additive, announced by capabilities). */
export const PROTOCOL = { major: 1, minor: 0 } as const;

/** Node flags (bit mask `f` of a wire node). */
export const NODE_FLAGS = {
  visible: 1,
  clickable: 2,
  focusable: 4,
  focused: 8,
  enabled: 16,
  checked: 32,
  selected: 64,
  editable: 128,
  scrollable: 256,
  password: 512,
  checkable: 1024,
  longClickable: 2048,
} as const;
export type NodeFlag = keyof typeof NODE_FLAGS;

const Rect = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/** One node of the screen as an agent sends it; `b` is [left, top, right, bottom] in device pixels. */
export const WireNode = z.object({
  /** Parent index in `nodes`, -1 for a window root. */
  p: z.number().int(),
  /** Window index in `windows`. */
  w: z.number().int().nonnegative(),
  /** Class (Android) or element type (iOS). */
  c: z.string(),
  id: z.string().optional(),
  t: z.string().optional(),
  d: z.string().optional(),
  h: z.string().optional(),
  b: Rect,
  f: z.number().int().nonnegative(),
});
export type WireNode = z.infer<typeof WireNode>;

export const WireWindow = z.object({
  /** Android AccessibilityWindowInfo type: 1 application, 2 input method, 3 system, 4 overlay, … */
  type: z.number().int(),
  pkg: z.string().optional(),
  layer: z.number().int(),
  b: Rect,
  active: z.boolean(),
  focused: z.boolean(),
});
export type WireWindow = z.infer<typeof WireWindow>;

export const Tree = z.object({
  windows: z.array(WireWindow),
  nodes: z.array(WireNode),
  /** A limit (depth, nodes, time) cut the walk short. */
  truncated: z.boolean(),
  elapsedMs: z.number(),
  /** Layout digest (class, id, bounds; no text): equal digests are the same settled layout. */
  hash: z.string(),
});
export type Tree = z.infer<typeof Tree>;

export const Settle = z.object({
  /** Quiet window after the action before a read counts. */
  quietMs: z.number().int().min(0).max(5_000).default(200),
  /** Longest the agent waits for the layout to stop changing. */
  maxMs: z.number().int().min(0).max(15_000).default(3_000),
});
export type SettleInput = z.input<typeof Settle>;

export const SettleResult = z.object({
  settled: z.boolean(),
  ms: z.number(),
  reads: z.number().int(),
});
export type SettleResult = z.infer<typeof SettleResult>;

export const Read = z.enum(['none', 'hash', 'tree']);
export type Read = z.infer<typeof Read>;

const Point = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Point>;

/** One finger's path: points with their time offset from the gesture start (ms). */
const Pointer = z.array(z.object({ x: z.number(), y: z.number(), t: z.number().min(0) })).min(1);

export const KEYS = ['back', 'home', 'enter', 'delete', 'tab', 'appSwitch'] as const;
export type Key = (typeof KEYS)[number];

export const ActParams = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tap'), ...Point.shape }),
  z.object({
    kind: z.literal('longPress'),
    ...Point.shape,
    durationMs: z.number().int().min(100).max(10_000),
  }),
  z.object({
    kind: z.literal('swipe'),
    from: Point,
    to: Point,
    durationMs: z.number().int().min(20).max(10_000),
  }),
  z.object({ kind: z.literal('gesture'), pointers: z.array(Pointer).min(1).max(5) }),
  z.object({ kind: z.literal('key'), key: z.enum(KEYS) }),
]);
export type ActParams = z.infer<typeof ActParams>;

export const Hello = z.object({
  agentVersion: z.string(),
  protocol: z.object({ major: z.number().int(), minor: z.number().int() }),
  platform: z.enum(['android', 'ios']),
  osVersion: z.string(),
  sdk: z.number().int().optional(),
  model: z.string(),
  screen: z.object({ w: z.number(), h: z.number(), density: z.number(), rotation: z.number() }),
  capabilities: z.array(z.string()),
  pid: z.number().int().optional(),
});
export type Hello = z.infer<typeof Hello>;

export const ActResult = z.object({
  settle: SettleResult.optional(),
  hash: z.string().optional(),
  tree: Tree.optional(),
});
export type ActResult = z.infer<typeof ActResult>;

export const TextResult = ActResult.extend({
  /** How the text got in: set on the node, pasted, or typed as key events. */
  mode: z.enum(['setText', 'paste', 'keys']),
  verified: z.boolean(),
  focusMs: z.number(),
});
export type TextResult = z.infer<typeof TextResult>;

export const Screenshot = z.object({
  w: z.number().int(),
  h: z.number().int(),
  format: z.enum(['png', 'jpeg']),
  bytes: z.number().int(),
});

export const Foreground = z.object({ pkg: z.string().optional() });

/** Requests the host sends, with their params and result schemas (the agent validates its side). */
export const METHODS = {
  hello: {
    params: z.object({ token: z.string(), protocol: z.number().int() }),
    result: Hello,
  },
  ping: { params: z.object({}), result: z.object({ uptimeMs: z.number() }) },
  'tree.get': {
    params: z.object({
      maxDepth: z.number().int().min(1).max(500).optional(),
      maxNodes: z.number().int().min(1).max(20_000).optional(),
    }),
    result: Tree,
  },
  act: {
    params: z.object({
      action: ActParams,
      settle: Settle.optional(),
      read: Read.default('none'),
      /** The layout digest the caller saw: an equal digest after the action ends the settle at once. */
      before: z.string().optional(),
    }),
    result: ActResult,
  },
  'text.set': {
    params: z.object({
      text: z.string().max(5_000),
      replace: z.boolean().default(false),
      submit: z.boolean().default(false),
      /** Tap here first and wait for an editable field to take focus. */
      at: Point.optional(),
      focusTimeoutMs: z.number().int().min(0).max(10_000).default(2_000),
      settle: Settle.optional(),
      read: Read.default('none'),
    }),
    result: TextResult,
  },
  screenshot: {
    params: z.object({
      format: z.enum(['png', 'jpeg']).default('jpeg'),
      quality: z.number().int().min(10).max(100).default(80),
      maxPx: z.number().int().min(64).max(8_192).optional(),
    }),
    result: Screenshot,
  },
  'app.foreground': { params: z.object({}), result: Foreground },
  'clipboard.set': { params: z.object({ text: z.string().max(10_000) }), result: z.object({}) },
  'clipboard.get': { params: z.object({}), result: z.object({ text: z.string().optional() }) },
  'orientation.set': {
    params: z.object({
      rotation: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    }),
    result: z.object({}),
  },
  cancel: { params: z.object({ id: z.number().int() }), result: z.object({}) },
  shutdown: { params: z.object({}), result: z.object({}) },
} as const;
export type Method = keyof typeof METHODS;
export type ParamsOf<M extends Method> = z.input<(typeof METHODS)[M]['params']>;
export type ResultOf<M extends Method> = z.infer<(typeof METHODS)[M]['result']>;
