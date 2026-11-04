import { SYSTEM_VIEWS, type SystemView } from '@appdyno/core';
import { KEYS, MODIFIERS, type Key, type Modifier } from '@appdyno/protocol';
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

/** A key as a tool takes it: the wire's `volumeUp` is `volume_up`. */
export const keyName = (k: Key) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const WIRE_KEY: Record<string, Key | undefined> = Object.fromEntries(
  KEYS.map((k) => [keyName(k), k]),
);

/** What a key that is a button takes: nothing is held during it. */
const BUTTONS: ReadonlySet<string> = new Set<Key>([
  'back',
  'home',
  'appSwitch',
  'volumeUp',
  'volumeDown',
  'power',
  'lock',
]);

export const viewNamed = (words: string) => SYSTEM_VIEWS.find((v): v is SystemView => v === words);

/** `command+a` as the wire has it: what is held, then the key by its name, or a letter or digit. */
export function keyPress(words: string): { key: string; modifiers: Modifier[] } | undefined {
  const parts = words.split('+');
  const last = parts.pop()!;
  const key = WIRE_KEY[last] ?? (/^[a-z0-9]$/.test(last) ? last : undefined);
  const modifiers = parts.filter((m): m is Modifier => MODIFIERS.includes(m as Modifier));
  if (!key || modifiers.length !== parts.length || (parts.length > 0 && BUTTONS.has(key)))
    return undefined;
  return { key, modifiers };
}

// a check, not an enum: 36 more words would cost the catalog more than the names in the description
const KeyWords = z
  .string()
  .refine(
    (k) => !!keyPress(k) || !!viewNamed(k),
    `a key as press_key lists it, or a letter or digit: command+a`,
  );

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

export const KeyStep = z
  .object({
    action: z.literal('press_key'),
    key: KeyWords,
    count: z.number().int().min(1).max(100).optional(),
  })
  .strict();

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
