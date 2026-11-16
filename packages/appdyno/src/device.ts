import { buildScreen, oneOf, refName, selectIn, touchPoint, withShownWords } from '@appdyno/core';
import {
  claim,
  DEFAULT_POLICY,
  release,
  ServerContext,
  SETTLE,
  settleBy,
  SHARE_BY_LIBRARY,
  ToolError,
} from '@appdyno/ops';
import { regularExpression } from './allow.js';
import type { ErrorCode } from './library.js';
import { deviceProviders } from './providers.js';

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
};

/** Names an element by what it shows instead of where it is. `index` picks one of several matches, from 0. */
export type Selector = { text?: string; id?: string; role?: string; index?: number };

/** One read of the screen. */
export type Screen = {
  elements: ScreenElement[];
  /** Names this read: a touch given it as `before` is refused where another window has come in front since. */
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
  /** The `hash` of the read the touch was aimed on. */
  before?: string;
};

/** What a touch did: whether the screen came to rest after it, in the time a touch waits. */
export type Touched = { settled: boolean };

/** `verified`: whether the field read back holds the text, where it can be read back. `submitted`: false where enter was not pressed. */
export type Typed = Touched & { verified?: boolean; submitted?: boolean };

export type { ErrorCode };

/** What a refused call throws. */
export type DeviceRefusal = Error & { code: ErrorCode; hint?: string };

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
  /** Lets the device go. */
  close(): Promise<void>;
};

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

/** Every touch waits for the screen to come to rest, by the device's own measure. */
const REST = { settle: {} };

const settled = (r: { settle?: { settled: boolean } | undefined }): Touched => ({
  settled: r.settle?.settled === true,
});

/**
 * A device by its serial, opened by the driver that takes it and held for this process until `close`: one another
 * process holds is refused `DEVICE_CLAIMED`, and one `allowDevices` does not name `POLICY_DENIED`.
 */
export async function openDevice(serial: string, options: OpenOptions = {}): Promise<Device> {
  const { app, share = false } = options;
  const allowDevices = regularExpression(options.allowDevices);
  const device = new ServerContext(
    { ...DEFAULT_POLICY, ...(allowDevices && { devices: allowDevices }) },
    deviceProviders(),
  ).deviceFor(serial);
  const letGo = (held = !share) => {
    device.close();
    if (held) release(serial);
  };
  if (!share)
    await claim(serial, 'appdyno device', SHARE_BY_LIBRARY).catch((e: unknown) => {
      letGo(false);
      throw e;
    });
  await device.open().catch((e: unknown) => {
    letGo();
    throw e;
  });
  const screen = async (): Promise<Screen> => {
    const { list, hash, foreground, window } = buildScreen(await device.tree(), {
      port: device.platformScreen,
      ...(app && { appId: app }),
    });
    return { elements: list, hash, ...(foreground && { foreground }), ...(window && { window }) };
  };
  return {
    serial,
    platform: device.platform,
    virtual: device.virtual,
    screen,
    tap: async (at, o) => settled(await device.tap(at, { ...REST, ...o })),
    longPress: async (at, ms, o) => settled(await device.longPress(at, ms, { ...REST, ...o })),
    swipe: async (from, to, ms, o) => settled(await device.swipe(from, to, ms, { ...REST, ...o })),
    key: async (key) => settled(await device.key(key, REST)),
    async typeText(text, o) {
      const r = await device.typeText(text, { ...REST, ...o });
      return {
        ...settled(r),
        ...(r.verified !== undefined && { verified: r.verified }),
        ...(r.submitted !== undefined && { submitted: r.submitted }),
      };
    },
    async launch(id) {
      await device.launch(id);
      // a read right after a launch catches a screen still laying out, and a touch aimed on it lands elsewhere
      const { settled } = await settleBy(screen, SETTLE.quietMs, SETTLE.maxMs);
      return { settled };
    },
    terminate: (id) => device.terminate(id),
    foreground: () => device.foreground(),
    close() {
      letGo();
      return Promise.resolve();
    },
  };
}

/** The elements a selector names on a read, an exact match of its text before one that only holds it. */
export const select = (screen: Screen, selector: Selector): ScreenElement[] =>
  selectIn(screen.elements, selector);

/**
 * The one element a selector or a ref names on a read, and where a touch on it goes. A touch that takes `on` as its
 * `before` is compared with this read, so one found on a dialog that came in front by itself is touched there.
 * Refused `NOT_FOUND` with no match, `AMBIGUOUS` with several that stand apart, `STALE` for a ref not on this read.
 */
export function aim(screen: Screen, target: Selector | { ref: string }): Aimed {
  const { elements, hash } = screen;
  const element =
    'ref' in target ? elements.find((e) => e.ref === target.ref) : found(elements, target);
  if (!element) throw new ToolError('the ref is not on this read', 'STALE', 'aim on a new read');
  return { element, ...touchPoint(element, elements), on: hash };
}

function found(elements: ScreenElement[], selector: Selector): ScreenElement {
  const hits = selectIn(elements, selector);
  const hit = oneOf(hits, selector.index);
  if (hit) return hit;
  const said = JSON.stringify(selector);
  if (hits.length === 0) throw new ToolError(`no element matches ${said}`, 'NOT_FOUND');
  if (selector.index !== undefined)
    throw new ToolError(`only ${hits.length} match ${said}, so its index names none`, 'NOT_FOUND');
  throw new ToolError(
    `${hits.length} elements match ${said}: ${hits.map((e) => refName(e.ref, e.label)).join('; ')}`,
    'AMBIGUOUS',
    'give the selector an index, 0 for the first, or aim by a ref',
  );
}

/**
 * An element by its ref and its words, as `@a1 "Play"`, and where `shown`, the words it was read with before, are not
 * its words now, by both: `@a1 "Close" (shown as "Play")`.
 */
export const nameOf = (element: ScreenElement, shown?: string): string =>
  withShownWords(refName(element.ref, element.label), element.ref, shown);
