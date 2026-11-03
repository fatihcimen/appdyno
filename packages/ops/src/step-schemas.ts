import { z } from 'zod';

/** The screen in the answer after an action: its changes, all of it, or nothing. */
export const Read = z.enum(['diff', 'full', 'none']).default('diff');

// a check, not a pattern: a pattern in the schema costs the catalog on every tool that takes a ref
export const Ref = z
  .string()
  .refine((r) => /^@[a-z0-9]{1,10}(-\d{1,3})?$/.test(r), 'a ref as the screen shows it (@k3f9)');

// a check, not a schema bound, for the same reason as Ref
export const Coord = z.number().refine((v) => v >= 0 && v <= 10_000, 'a point on the screen');

export const Selector = z
  .object({
    text: z.string().optional(),
    id: z.string().optional(),
    role: z.string().optional(),
    // a check, not .int(): its safe-integer bounds would cost the catalog on every tool with a selector
    index: z.number().refine(Number.isInteger, 'a whole number').optional(),
  })
  .strict();

export const Target = {
  ref: Ref.optional(),
  x: Coord.optional(),
  y: Coord.optional(),
  selector: Selector.optional(),
};

export const Direction = z.enum(['up', 'down', 'left', 'right']);

export const Keys = z.enum([
  'back',
  'enter',
  'home',
  'delete',
  'tab',
  'app_switch',
  'volume_up',
  'volume_down',
  'power',
  'lock',
]);

export const WAIT_MS = 5_000;

export const MAX_WAIT_MS = 15_000;

const SCROLL_MAX = 10;

export const Check = z.enum(['exists', 'absent', 'text', 'enabled', 'checked', 'focused']);

const TapStep = z.object({ action: z.literal('tap'), ...Target }).strict();

export const LongPressStep = z
  .object({
    action: z.literal('long_press'),
    ...Target,
    durationMs: z.number().int().min(100).max(5_000).optional(),
  })
  .strict();

export const SwipeStep = z
  .object({
    action: z.literal('swipe'),
    direction: Direction,
    ...Target,
    distance: z.number().min(10).max(5_000).optional(),
    durationMs: z.number().int().min(50).max(5_000).optional(),
  })
  .strict();

export const TypeStep = z
  .object({
    action: z.literal('type_text'),
    text: z.string().max(500),
    ...Target,
    replace: z.boolean().optional(),
    submit: z.boolean().optional(),
  })
  .strict();

const KeyStep = z.object({ action: z.literal('press_key'), key: Keys }).strict();

export const DoubleTapStep = z.object({ action: z.literal('double_tap'), ...Target }).strict();

export const DragStep = z
  .object({
    action: z.literal('drag'),
    ...Target,
    to: z.object(Target).strict(),
    durationMs: z.number().int().min(50).max(10_000).optional(),
  })
  .strict();

export const WaitStep = z
  .object({
    action: z.literal('wait_for'),
    ref: Ref.optional(),
    ...Selector.shape,
    gone: z.boolean().default(false),
    timeoutMs: z.number().int().min(300).max(MAX_WAIT_MS).default(WAIT_MS),
  })
  .strict();

export const AssertStep = z
  .object({
    action: z.literal('assert'),
    ref: Ref.optional(),
    ...Selector.shape,
    check: Check.default('exists'),
    equals: z.string().max(2_000).optional(),
    expect: z.boolean().default(true),
    timeoutMs: z.number().int().min(0).max(MAX_WAIT_MS).default(0),
  })
  .strict();

export const ScrollStep = z
  .object({
    action: z.literal('scroll_to'),
    selector: Selector,
    direction: Direction.default('up'),
    maxSwipes: z.number().int().min(1).max(50).default(SCROLL_MAX),
    x: Coord.optional(),
    y: Coord.optional(),
  })
  .strict();

export const Step = z.discriminatedUnion('action', [
  TapStep,
  LongPressStep,
  DoubleTapStep,
  DragStep,
  SwipeStep,
  TypeStep,
  KeyStep,
  WaitStep,
  AssertStep,
  ScrollStep,
]);

export type Step = z.infer<typeof Step>;
