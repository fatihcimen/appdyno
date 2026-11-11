import { z } from 'zod';
import { TextClip, Traversal } from './a11y.js';
import { AUDIT_TYPES, AuditResult } from './audit.js';
import { KeyName, MODIFIERS } from './keys.js';
import { Tree } from './tree.js';

/** The wire's version: a host and an agent of another one do not talk. */
export const PROTOCOL = { major: 2 } as const;

/** What a settle waits for when it is not told: what the host asks after an action is the same. */
export const SETTLE_DEFAULT = { quietMs: 200, maxMs: 3_000 } as const;

export const Settle = z.object({
  /** Quiet window after the action before a read counts. */
  quietMs: z.number().int().min(0).max(5_000).default(SETTLE_DEFAULT.quietMs),
  /** Longest the agent waits for the layout to stop changing. */
  maxMs: z.number().int().min(0).max(15_000).default(SETTLE_DEFAULT.maxMs),
});
export type SettleInput = z.input<typeof Settle>;

export const SettleResult = z.object({
  settled: z.boolean(),
  ms: z.number(),
  reads: z.number().int(),
  /** The quiet window in effect: shorter after a tap on something that cannot react (plain text, empty
   * space), stretched on a loaded device. */
  quietMs: z.number().int().optional(),
  /** What the agent waited past `ms` for a system alert: a wait of its own, which no time of the app's includes. */
  idleMs: z.number().int().optional(),
  /** The content is still but a window transition runs: places given are those it comes to rest at. */
  moving: z.boolean().optional(),
});
export type SettleResult = z.infer<typeof SettleResult>;

export const Read = z.enum(['none', 'hash', 'tree']);
export type Read = z.infer<typeof Read>;

const Point = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Point>;

/** One finger's path: points with their time offset from the gesture start (ms). */
const Pointer = z.array(z.object({ x: z.number(), y: z.number(), t: z.number().min(0) })).min(1);

export const ActParams = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tap'), ...Point.shape }),
  z.object({ kind: z.literal('doubleTap'), ...Point.shape }),
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
  z.object({
    kind: z.literal('key'),
    key: KeyName,
    modifiers: z.array(z.enum(MODIFIERS)).optional(),
  }),
]);
export type ActParams = z.infer<typeof ActParams>;

/** Each has a driver; what a new one touches outside it is named in `packages/appdyno/test/platforms.test.ts`. */
export const PLATFORMS = ['android', 'ios'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const Hello = z.object({
  agentVersion: z.string(),
  protocol: z.object({ major: z.number().int() }),
  platform: z.enum(PLATFORMS),
  osVersion: z.string(),
  sdk: z.number().int().optional(),
  model: z.string(),
  screen: z.object({ w: z.number(), h: z.number(), density: z.number(), rotation: z.number() }),
  pid: z.number().int().optional(),
  /** iOS: the runner's private shims checked at start (a replacement called with a BOOL in every slot). */
  idleShimChecked: z.boolean().optional(),
});
export type Hello = z.infer<typeof Hello>;

export const ActResult = z.object({
  settle: SettleResult.optional(),
  /** iOS: how long the touch waited for the app's animations to end (UIKit takes no touches during them). */
  animationWaitMs: z.number().optional(),
  hash: z.string().optional(),
  tree: Tree.optional(),
  /** The process of the app `pidOf` named once the action is over, 0 for none; absent where the agent cannot tell. */
  pid: z.number().int().min(0).optional(),
});
export type ActResult = z.infer<typeof ActResult>;

export const TextResult = ActResult.extend({
  /** How the text got in: set on the node, pasted, or typed as key events. */
  mode: z.enum(['setText', 'paste', 'keys']),
  /** The field read back: true when it holds the text, false when it does not; absent when it cannot be
   * read back (a password, a code entry no element of which has the focus, a field gone after it submitted). */
  verified: z.boolean().optional(),
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

/**
 * Requests the host sends, with their params and result schemas. `RpcClient.call` parses the params, so
 * a default here is what goes on the wire and an agent has none of its own.
 */
export const METHODS = {
  hello: {
    params: z.object({ token: z.string(), protocol: z.number().int() }),
    result: Hello,
  },
  ping: {
    params: z.object({}),
    /** `atMs`: the device's wall clock as it answers, in ms since the epoch: answered at once, so a host can time it. */
    result: z.object({ uptimeMs: z.number(), atMs: z.number() }),
  },
  'tree.get': {
    params: z.object({
      maxDepth: z.number().int().min(1).max(500).default(128),
      maxNodes: z.number().int().min(1).max(20_000).default(5_000),
      /** iOS: this app's read, whichever is in front, with the runner's target left as it was. */
      pkg: z.string().optional(),
    }),
    result: Tree,
  },
  act: {
    params: z.object({
      action: ActParams,
      settle: Settle.optional(),
      read: Read.default('none'),
      /**
       * The layout digest the caller saw: the first read after the action is compared with it, so an
       * unchanged screen counts as still from the action's end (no second read needed to start the
       * window), and a tap on something that cannot react settles after a short window.
       */
      before: z.string().optional(),
      /** Android: an app whose process the answer names, as a host compares it with the one before the action. */
      pidOf: z.string().optional(),
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
      /** A ceiling: the text goes in as soon as a field reports the focus. */
      focusTimeoutMs: z.number().int().min(0).max(10_000).default(5_000),
      settle: Settle.optional(),
      read: Read.default('none'),
      pidOf: z.string().optional(),
    }),
    result: TextResult,
  },
  /** iOS only: a person's letters, by no element, so none of them reaches a log. */
  'text.keys': {
    params: z.object({
      text: z.string().max(5_000),
      /** Only into the field over this point, once it has the focus; nothing is tapped. */
      into: Point.optional(),
      focusTimeoutMs: z.number().int().min(0).max(10_000).default(6_000),
    }),
    result: z.object({ focusMs: z.number() }),
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
  /** iOS: what an app was answered for a protected resource, forgotten, so that it asks again. */
  'permission.reset': {
    params: z.object({ pkg: z.string().min(1).max(255), service: z.string().min(1).max(40) }),
    result: z.object({}),
  },
  /** iOS: the app the runner reads and acts on while it is in front. */
  'app.target': { params: z.object({ pkg: z.string().min(1).max(255) }), result: z.object({}) },
  /** Android: what a launcher calls each app. */
  'app.labels': {
    params: z.object({}),
    result: z.object({ apps: z.array(z.object({ id: z.string(), name: z.string() })) }),
  },
  'clipboard.set': { params: z.object({ text: z.string().max(10_000) }), result: z.object({}) },
  /** iOS: until the app under a point has no animation running (UIKit takes no touches during one). */
  'animations.wait': {
    params: z.object({ x: z.number(), y: z.number() }),
    result: z.object({ ms: z.number().optional() }),
  },
  'clipboard.get': { params: z.object({}), result: z.object({ text: z.string().optional() }) },
  'orientation.set': {
    params: z.object({
      rotation: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
      /** The host wrote the lock down as a condition: the agent keeps the turn past its release of UI automation. */
      kept: z.boolean().optional(),
    }),
    result: z.object({}),
  },
  /** iOS: the platform accessibility audit of the app in front. */
  audit: {
    params: z.object({
      types: z.array(z.enum(AUDIT_TYPES)).max(AUDIT_TYPES.length).optional(),
      maxIssues: z.number().int().min(1).max(200).default(50),
    }),
    result: AuditResult.omit({ engine: true, read: true }),
  },
  /**
   * Android: a tree read with what an accessibility audit needs besides: the
   * nodes' traversal hints, and for up to `maxNodes` text nodes how many characters have no visible place
   * on the screen (the platform's character locations).
   */
  /** Blocks on the device until the screen's digest differs from `since`; no `since`: answers at once. */
  wait: {
    params: z.object({
      since: z.string().optional(),
      timeoutMs: z.number().int().min(0).max(60_000),
      minMs: z.number().int().min(0).max(60_000).default(300),
    }),
    result: z.object({
      sig: z.string(),
      changed: z.boolean(),
      reads: z.number().int(),
      elapsedMs: z.number(),
      tree: Tree.optional(),
    }),
  },
  'a11y.read': {
    params: z.object({ maxNodes: z.number().int().min(1).max(200).default(60) }),
    result: z.object({ tree: Tree, clips: z.array(TextClip), traversal: z.array(Traversal) }),
  },
  /** Android: until a running window transition has ended (an answer can come before that). */
  'rest.wait': { params: z.object({}), result: z.object({}) },
  /** Android: the whole device's languages as tags, set first when `set` is given: the system keeps them through a reboot. */
  locales: {
    params: z.object({ set: z.string().min(2).max(200).optional() }),
    result: z.object({ tags: z.string() }),
  },
  /** Android: the device's animation scales off, back when the last host leaves. */
  'animations.set': { params: z.object({ off: z.boolean() }), result: z.object({}) },
  /** Android: one phase of a person's touch, in fractions of the screen, with no settle. */
  touch: {
    params: z.object({
      p: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      x: z.number(),
      y: z.number(),
      x2: z.number().optional(),
      y2: z.number().optional(),
    }),
    result: z.object({}),
  },
  /** Android: frames on this connection until it ends, asked for by the viewer, which talks to the agent itself. */
  'stream.start': {
    params: z.object({
      codec: z.enum(['h264', 'hevc']).default('h264'),
      quality: z.enum(['auto', 'high', 'standard']).default('auto'),
      maxSize: z.number().int().positive().optional(),
      /** So many encoders fail first, for a test of the ladder. */
      failFirst: z.number().int().nonnegative().optional(),
      /** Where `auto` starts, for a test that cannot wait for a load to take it there. */
      startSize: z.number().int().positive().optional(),
      /** What a run must beat to show room, for a test on a device a busy Mac leaves none on. */
      roomMs: z.number().int().positive().optional(),
    }),
    result: z.object({}),
  },
  /** Android: the clock frames are stamped by, in ns, for the host to find the offset by its shortest round trip. */
  'stream.clock': { params: z.object({}), result: z.object({ now: z.number() }) },
  /** Android: a fresh keyframe from each stream of this agent. */
  'stream.sync': { params: z.object({}), result: z.object({}) },
  /** Android: how many streams run, and whether the screen is on. */
  'stream.status': {
    params: z.object({}),
    result: z.object({
      active: z.number().int(),
      on: z.boolean(),
      /** The screen as apps see it now, and its quarter turns from how it was built. */
      w: z.number().int(),
      h: z.number().int(),
      rotation: z.number().int(),
      modes: z.array(z.string()),
      dropped: z.number(),
      /** Too slow at the smallest size a person can read: it stays there. */
      behind: z.boolean().optional(),
    }),
  },
  cancel: { params: z.object({ id: z.number().int() }), result: z.object({}) },
  shutdown: { params: z.object({}), result: z.object({}) },
} as const;
/**
 * What goes to a viewer with no id and wants no answer: from the agent, or on a phone from the stream's own writer to a
 * pipe. All of it reads the same in the viewer, so a field here is a field in all three.
 */
export const NOTIFICATIONS = {
  /** The picture, before its first frame and on each new encoder. A phone's `crop`: the picture is larger than the screen. */
  'stream.info': z.object({
    w: z.number().int(),
    h: z.number().int(),
    codec: z.enum(['h264', 'hevc']),
    mode: z.string(),
    crop: z.boolean().optional(),
  }),
  /** It will not go on, and why. */
  'stream.end': z.object({ why: z.string() }),
  /** A phone: since the stream began, by name, for the viewer's stats. */
  'stream.counters': z.record(z.string(), z.number()),
  /** A phone: quarter turns to stand the picture up, as nothing in its stream says so. */
  'stream.turns': z.object({ turns: z.number().int() }),
} as const;
export type Notification = keyof typeof NOTIFICATIONS;
export type StreamInfo = z.infer<(typeof NOTIFICATIONS)['stream.info']>;

export type Method = keyof typeof METHODS;
export type ParamsOf<M extends Method> = z.input<(typeof METHODS)[M]['params']>;
export type ResultOf<M extends Method> = z.infer<(typeof METHODS)[M]['result']>;
