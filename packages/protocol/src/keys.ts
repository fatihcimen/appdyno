import { z } from 'zod';

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

/** A keyboard's USB HID page; 12 is the consumer page of hardware buttons. */
const KEYBOARD = 7;
const BUTTONS = 12;

/** Each key's USB HID usage, or that it has none: the one table, so that a new key has to say. */
export const KEY_USAGES = {
  back: undefined,
  home: { page: BUTTONS, usage: 0x40 },
  enter: { page: KEYBOARD, usage: 0x28 },
  delete: { page: KEYBOARD, usage: 0x2a },
  tab: { page: KEYBOARD, usage: 0x2b },
  appSwitch: undefined,
  volumeUp: { page: BUTTONS, usage: 0xe9 },
  volumeDown: { page: BUTTONS, usage: 0xea },
  power: { page: BUTTONS, usage: 0x30 },
  lock: { page: BUTTONS, usage: 0x30 },
  escape: { page: KEYBOARD, usage: 0x29 },
  space: { page: KEYBOARD, usage: 0x2c },
  arrowUp: { page: KEYBOARD, usage: 0x52 },
  arrowDown: { page: KEYBOARD, usage: 0x51 },
  arrowLeft: { page: KEYBOARD, usage: 0x50 },
  arrowRight: { page: KEYBOARD, usage: 0x4f },
  mute: undefined,
  siri: undefined,
} as const satisfies Record<Key, { page: number; usage: number } | undefined>;

const KEY_OF_USAGE = new Map(
  KEYS.flatMap((key) => {
    const at = KEY_USAGES[key];
    return at?.page === KEYBOARD ? [[at.usage as number, key] as const] : [];
  }),
);

/** The key a keyboard's usage names; undefined for one no key has. */
export const keyOfUsage = (usage: number): Key | undefined => KEY_OF_USAGE.get(usage);
