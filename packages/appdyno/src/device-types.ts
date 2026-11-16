import type { ErrorCode, Policy, Signing } from './library.js';

export type { ErrorCode, Policy, Signing };

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
   * it is the tree's order alone; from `audit` on Android it also follows the elements that name another to be read
   * before or after. A screen reader may go another way, as VoiceOver does by place on the screen. None for an
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
  /** The app the screen is read for, and the one `logs` reads where it names none. */
  app?: string;
  /** Devices it may drive; with none, any. */
  allowDevices?: RegExp;
  /** Drive a device another process holds, and hold it from no one. */
  share?: boolean;
  /**
   * What this device may show and do. `secrets` are hidden in an element's `label`, `whole` and `id`, in log lines and
   * in an audit's words. `apps`: the only apps `launch`, `terminate`, `clearData` and `logs` take, and a link opens in.
   * `urls`: the only links `openLink` opens. `write`: folders `screenshot` may write a file in, beside the folder the
   * program runs in and appdyno's own state folder. A call outside them is refused `POLICY_DENIED`. A touch is still
   * a touch: none of this asks anything of one.
   */
  policy?: Policy;
  /** An iPhone's signing for this device alone, in place of the `APPDYNO_IOS_PROFILE` variables: see `Signing`. */
  signing?: Signing;
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

export type ShotOptions = {
  /** `png` with none given. */
  format?: 'png' | 'jpeg';
  /** A JPEG's quality, 10 to 100. */
  quality?: number;
  /** Its longer side at most this many pixels. */
  maxPx?: number;
};

/** A picture of the screen, in pixels. */
export type Shot = { format: 'png' | 'jpeg'; width: number; height: number };

/** One line of an app's log. `at`: its time on the device's clock, in ms since the epoch, where the platform tells it. */
export type LogLine = { text: string; at?: number; level?: 'warn' | 'error' };

export type LogsQuery = {
  /** With none, the app the device was opened for. */
  app?: string;
  /** Lines from this time on, in ms since the epoch, by the device's clock; with none, the newest. */
  since?: number;
  /** 200 with none given, 1000 at most. */
  maxLines?: number;
  /** The least a line must be: `info` with none given. */
  level?: 'verbose' | 'debug' | 'info' | 'warn' | 'error';
};

/** `source`: where the lines came from. `note`: what the platform could not give. */
export type Logs = { lines: LogLine[]; source: string; note?: string };

/**
 * One window of the screen, as the device lists it: `layer`, higher over lower; `active`, the one a person acts in;
 * `focused`, the one keys go to. An iPhone lists the app in front and, over it, the system's alert.
 */
export type DeviceWindow = {
  type: 'app' | 'keyboard' | 'system' | 'overlay' | 'other';
  pkg?: string;
  rect: Rect;
  layer: number;
  active: boolean;
  focused: boolean;
};

/** `keyboard`: where the on-screen keyboard is, while it is open and the device says where. */
export type Windows = { windows: DeviceWindow[]; keyboard?: Rect };

export type Orientation = 'portrait' | 'landscape_left' | 'upside_down' | 'landscape_right';

/** One accessibility issue. `type`: its kind, as `contrast` or `hitRegion`. `rule`: the engine's own name for it. */
export type AuditIssue = {
  type: string;
  rule: string;
  message: string;
  /** The words of the element it is about, where it has any. */
  label?: string;
  /** Where that element is; none where it is gone. */
  rect?: Rect;
};

/**
 * `elements`: the screen the checks ran on, each with its `parent` and its `order`. `order`: their refs as a screen
 * reader goes through them. `truncated`: there were more issues than were asked for, or the time ran out.
 */
export type Audit = {
  issues: AuditIssue[];
  truncated: boolean;
  elements: ScreenElement[];
  order: string[];
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
  /**
   * A picture of the screen as it is: its bytes, or with `path` a file written there, which `policy.write` and the
   * two folders it adds to must hold. Secrets are hidden in text alone: a picture shows the screen as it was.
   */
  screenshot(options: ShotOptions & { path: string }): Promise<Shot & { path: string }>;
  screenshot(options?: ShotOptions): Promise<Shot & { data: Uint8Array }>;
  /** The app's own log lines, the oldest first, each a line of data. */
  logs(query?: LogsQuery): Promise<Logs>;
  /**
   * Opens a link, in `app` where one is given, and waits for the screen it opens to come to rest. Refused
   * `POLICY_DENIED` for a scheme that reaches files or code, as a tool refuses it, for a link `policy.urls` does not
   * name, for one that would open in an app `policy.apps` does not, and for one that places a call unless
   * `policy.urls` names it.
   */
  openLink(url: string, options?: { app?: string }): Promise<Touched>;
  /** The windows on the screen, and where the keyboard is. */
  windows(): Promise<Windows>;
  /** Turns the device. A quarter turn's name is the side its top goes to. */
  setOrientation(orientation: Orientation): Promise<void>;
  /** The accessibility issues of the screen, with the elements the checks ran on and the order they are read in. */
  audit(options?: { types?: string[]; maxIssues?: number }): Promise<Audit>;
  /** Clears the app's data, on an emulator or a simulator alone: on a phone it is refused `UNSUPPORTED`. */
  clearData(app: string): Promise<void>;
  /**
   * Ends the device's agent, the iOS runner or the Android agent, and lets the device go, as `close` does: what a
   * test does at its end, so that another driver can take the device. While another live process of this Mac uses
   * that agent it is refused `AGENT_CONFLICT`, unless `force`.
   */
  stopAgent(options?: { force?: boolean }): Promise<void>;
  /** Lets the device go, and leaves its agent running for the next to open it. */
  close(): Promise<void>;
};
