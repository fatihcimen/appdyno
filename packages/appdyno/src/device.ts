import {
  buildScreen,
  claim,
  refName,
  release,
  seek,
  seekOn,
  selectIn,
  settleBy,
  SHARE_BY_LIBRARY,
  touchPoint,
  waitUntil,
  withShownWords,
  type Reads,
  type Sought,
} from '@appdyno/core';
import { DEFAULT_POLICY, ServerContext } from '@appdyno/ops';
import { DeviceError, SETTLE_DEFAULT, type Tree } from '@appdyno/protocol';
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
  /**
   * `aim` on the screen just now, and where the element is not there yet, on the screens of the next `waitMs` (1500
   * with none given, 0 for no wait), as a tool waits for one still coming.
   */
  aim(target: Selector | { ref: string }, options?: { waitMs?: number }): Promise<Aimed>;
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
  const shown = (tree: Tree): Screen => {
    const { list, hash, foreground, window } = buildScreen(tree, {
      port: device.platformScreen,
      ...(app && { appId: app }),
    });
    return { elements: list, hash, ...(foreground && { foreground }), ...(window && { window }) };
  };
  const screen = async () => shown(await device.tree());
  const until = (met: (s: Screen) => boolean, ms: number) =>
    waitUntil(
      {
        read: () => screen().catch(() => undefined),
        changed: async (since, left) => {
          const r = await device.waitChange(since, left).catch(() => undefined);
          return (
            r && (r.tree ? { sig: r.sig, screen: shown(r.tree) } : { sig: r.sig, unchanged: true })
          );
        },
      },
      met,
      ms,
    );
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
      const { settled } = await settleBy(screen, SETTLE_DEFAULT.quietMs, SETTLE_DEFAULT.maxMs);
      return { settled };
    },
    terminate: (id) => device.terminate(id),
    foreground: () => device.foreground(),
    aim: async (target, { waitMs = AIM_WAIT_MS } = {}) =>
      aimed(await seek({ now: screen, until }, target, READS, waitMs), target),
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
export const aim = (screen: Screen, target: Selector | { ref: string }): Aimed =>
  aimed(seekOn(screen, target, READS), target);

/** How long `Device.aim` waits for an element still coming, as a tool does. */
const AIM_WAIT_MS = 1_500;

const READS: Reads<Screen, ScreenElement> = {
  list: (x) => x.elements,
  byRef: (x, ref) => x.elements.find((e) => e.ref === ref),
};

/** What was sought as where a touch on it goes, or the refusal of one not found. */
function aimed(got: Sought<Screen, ScreenElement>, target: Selector | { ref: string }): Aimed {
  if ('element' in got)
    return { element: got.element, ...touchPoint(got.element, got.list), on: got.screen.hash };
  const said = JSON.stringify(target);
  const n = got.hits.length;
  if (got.miss === 'unread') throw new DeviceError('NOT_FOUND', 'the screen could not be read');
  if (got.miss === 'ref')
    throw new DeviceError('STALE', 'the ref is not on this read', 'aim on a new read');
  if (got.miss === 'none') throw new DeviceError('NOT_FOUND', `no element matches ${said}`);
  if (got.miss === 'index')
    throw new DeviceError('NOT_FOUND', `only ${n} match ${said}, so its index names none`);
  throw new DeviceError(
    'AMBIGUOUS',
    `${n} elements match ${said}: ${got.hits.map((e) => refName(e.ref, e.label)).join('; ')}`,
    'give the selector an index, 0 for the first, or aim by a ref',
  );
}

/**
 * An element by its ref and its words, as `@a1 "Play"`, and where `shown`, the words it was read with before, are not
 * its words now, by both: `@a1 "Close" (shown as "Play")`.
 */
export const nameOf = (element: ScreenElement, shown?: string): string =>
  withShownWords(refName(element.ref, element.label), element.ref, shown);
