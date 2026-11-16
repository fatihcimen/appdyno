import type { ErrorCode } from './library.js';

export type { ErrorCode };

/** A place on the screen, in the units a touch takes: points on iOS, pixels on Android. */
export type Point = { x: number; y: number };

export type Rect = { x: number; y: number; width: number; height: number };

/** One element a person reads or taps. */
export type ScreenElement = {
  /** Its name on this screen and on the next read of it. */
  ref: string;
  role: string;
  /** Its words, cut short where they are long. */
  label: string;
  /** Its words uncut, where `label` is cut: what a selector's text is matched against. */
  whole?: string;
  /** Its identifier (an Android resource id without its package). */
  id?: string;
  rect: Rect;
  /** Its middle. */
  x: number;
  y: number;
  flags: ('clickable' | 'checked' | 'focused' | 'web')[];
  /** The place in `elements` of its nearest ancestor that is listed too; none for one that has none. */
  parent?: number;
  /** The app of the window it is in: a package on Android, a bundle id on iOS. */
  pkg?: string;
  /** Android: marked not important for accessibility, so a screen reader skips it. Set only when true. */
  notImportant?: boolean;
  /** Android: a screen reader reads it with what it holds as one. Set only when true. */
  screenReaderFocusable?: boolean;
  /**
   * Its place, from 0, in the order the tree gives a screen reader: each element, then what it holds. From `screen`
   * it is the tree's order alone. A screen reader may go another way, as VoiceOver does by place on the screen. None for an
   * element the tree does not hold, as the keyboard.
   */
  order?: number;
};

/** Names an element by what it shows instead of where it is. `index` picks one of several matches, from 0. */
export type Selector = { text?: string; id?: string; role?: string; index?: number };

/** One read of the screen. */
export type Screen = {
  elements: ScreenElement[];
  /** Names this read: what a touch takes as `before`. */
  hash: string;
  /** The app of the window in front. */
  foreground?: string;
  /** The screen's size, where the read shows it. */
  window?: { w: number; h: number };
};

export type OpenOptions = {
  /** The app the screen is read for. */
  app?: string;
  /** Devices it may drive; with none, any. */
  allowDevices?: RegExp;
  /** Drive a device another process holds, and hold it from no one. */
  share?: boolean;
};

export type TouchOptions = {
  /**
   * The `hash` of the read the touch was aimed on: the screen after the touch is settled against it. On Android a
   * touch whose `before` is a read from before another window of an app came in front is refused `STALE`, with
   * nothing sent, while that read is among the last 8 the device gave. iOS makes no such comparison: there the touch
   * is sent, so read again and aim again after a dialog came up by itself.
   */
  before?: string;
};

/** What a touch did: whether the screen came to rest after it, in the time a touch waits. */
export type Touched = { settled: boolean };

/** `verified`: whether the field read back holds the text, where it can be read back. `submitted`: false where enter was not pressed. */
export type Typed = Touched & { verified?: boolean; submitted?: boolean };

/** What a refused call throws. */
export type DeviceRefusal = Error & { code: ErrorCode; hint?: string };

/**
 * Where a touch on an element goes. `why` says where that is not its middle. `own`: on its own switch, `other`, as a
 * switch row's middle is its label. `clear`: clear of `other`, a smaller control of other words at its middle, which
 * would take the touch. `covered`: at its middle still, as no point of it is clear, and `other` may take the touch.
 */
export type Aimed = {
  element: ScreenElement;
  point: Point;
  why?: 'own' | 'clear' | 'covered';
  other?: ScreenElement;
  /** The read it was found on: what a touch takes as `before`. */
  on: string;
};

/** One device, whichever platform. */
export type Device = {
  readonly serial: string;
  readonly platform: 'android' | 'ios';
  /** An emulator or a simulator. */
  readonly virtual: boolean;
  /** A new read of the screen, whatever window is in front. */
  screen(): Promise<Screen>;
  tap(at: Point, options?: TouchOptions): Promise<Touched>;
  longPress(at: Point, durationMs?: number, options?: TouchOptions): Promise<Touched>;
  swipe(from: Point, to: Point, durationMs?: number, options?: TouchOptions): Promise<Touched>;
  /** A key by its name, as `back`, `home` or `enter`, or a letter or digit. */
  key(key: string): Promise<Touched>;
  /** Types into the focused field, or the one at `at`, tapped first. */
  typeText(
    text: string,
    options?: { at?: Point; replace?: boolean; submit?: boolean } & TouchOptions,
  ): Promise<Typed>;
  /** Starts the app, or brings it in front, and waits for its first screen to come to rest, as `launch_app` does. */
  launch(app: string): Promise<Touched>;
  terminate(app: string): Promise<void>;
  /** The app in front. */
  foreground(): Promise<string | undefined>;
  /**
   * `aim` on the screen just now, and where the element is not there yet, on the screens of the next `waitMs` (1500
   * with none given, 0 for no wait), as a tool waits for one still coming.
   */
  aim(target: Selector | { ref: string }, options?: { waitMs?: number }): Promise<Aimed>;
  /** Lets the device go. */
  close(): Promise<void>;
};
