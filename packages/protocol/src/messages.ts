import { z } from 'zod';

/** The wire's version: a host and an agent of another one do not talk. */
export const PROTOCOL = { major: 2 } as const;

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
  /** Android: not important for accessibility (a screen reader skips it; its children may be read). */
  notImportant: 4096,
  /** Android 9+: a screen reader reads it as one unit with its children. */
  screenReaderFocusable: 8192,
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
  /** The screen is off, though the app's windows may still be listed, as they are while a display dozes. */
  dark: z.boolean().optional(),
  /** A window is still sliding to its place: places given are those it comes to rest at. */
  moving: z.boolean().optional(),
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
  /** The quiet window in effect: shorter after a tap on something that cannot react (plain text, empty
   * space), stretched on a loaded device. */
  quietMs: z.number().int().optional(),
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

export const KEYS = [
  'back',
  'home',
  'enter',
  'delete',
  'tab',
  'appSwitch',
  'volumeUp',
  'volumeDown',
  'power',
  'lock',
  'escape',
  'space',
  'arrowUp',
  'arrowDown',
  'arrowLeft',
  'arrowRight',
  'mute',
  'siri',
] as const;
export type Key = (typeof KEYS)[number];

/** What is held during a keyboard key. Android has no command key: there it is Ctrl, which its text fields take. */
export const MODIFIERS = ['command', 'control', 'option', 'shift'] as const;
export type Modifier = (typeof MODIFIERS)[number];

/** A key by its name, or the letter or digit it types. */
export const KeyName = z.union([z.enum(KEYS), z.string().regex(/^[a-z0-9]$/)]);

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

/** Android `a11y.read`: a text node's characters and how many of them are not shown (cut or ellipsized). */
export const TextClip = z.object({
  n: z.number().int(),
  chars: z.number().int(),
  hidden: z.number().int(),
});
export type TextClip = z.infer<typeof TextClip>;
/** Android `a11y.read`: a node's traversal hints as node indices (a screen reader reads `n` before `before`, after `after`). */
export const Traversal = z.object({
  n: z.number().int(),
  before: z.number().int().optional(),
  after: z.number().int().optional(),
});
export type Traversal = z.infer<typeof Traversal>;

/**
 * The kinds of accessibility issue `audit` reports: the iOS platform audit's types; Android's checks use
 * the same names where they check the same thing, plus `imageContrast` and `duplicateLabel`.
 */
export const AUDIT_TYPES = [
  'contrast',
  'elementDetection',
  'hitRegion',
  'sufficientElementDescription',
  'dynamicType',
  'textClipped',
  'trait',
  'imageContrast',
  'duplicateLabel',
] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

export const AuditIssue = z.object({
  type: z.enum(AUDIT_TYPES),
  /** The engine's own rule: `XCUIAccessibilityAuditType.contrast` (iOS), `android.textContrast`. */
  rule: z.string(),
  message: z.string(),
  /** The element's [left, top, right, bottom] in tap units; absent when the element is gone. */
  b: Rect.optional(),
  /** The element as a tree node names it: class or type, id, description (label), text. */
  element: z
    .object({
      c: z.string(),
      id: z.string().optional(),
      d: z.string().optional(),
      t: z.string().optional(),
    })
    .optional(),
});
export type AuditIssue = z.infer<typeof AuditIssue>;

export const AuditResult = z.object({
  /** `platform`: the iOS platform audit; `rules`: the host's checks of the tree and a screenshot. */
  engine: z.enum(['platform', 'rules']),
  issues: z.array(AuditIssue),
  /** More issues than `maxIssues`, or the time ran out. */
  truncated: z.boolean(),
  elapsedMs: z.number(),
  /** Android: the read the checks ran on, with the screen reader's traversal hints (its reading order). */
  read: z.object({ tree: Tree, traversal: z.array(Traversal) }).optional(),
});
export type AuditResult = z.infer<typeof AuditResult>;

/**
 * Requests the host sends, with their params and result schemas. `RpcClient.call` parses the params, so
 * a default here is what goes on the wire and an agent has none of its own.
 */
export const METHODS = {
  hello: {
    params: z.object({ token: z.string(), protocol: z.number().int() }),
    result: Hello,
  },
  ping: { params: z.object({}), result: z.object({ uptimeMs: z.number() }) },
  'tree.get': {
    params: z.object({
      maxDepth: z.number().int().min(1).max(500).default(128),
      maxNodes: z.number().int().min(1).max(20_000).default(5_000),
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
  /** iOS: the app the runner reads and acts on while it is in front. */
  'app.target': { params: z.object({ pkg: z.string().min(1).max(255) }), result: z.object({}) },
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
export type Method = keyof typeof METHODS;
export type ParamsOf<M extends Method> = z.input<(typeof METHODS)[M]['params']>;
export type ResultOf<M extends Method> = z.infer<(typeof METHODS)[M]['result']>;
