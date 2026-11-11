import { z } from 'zod';

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
