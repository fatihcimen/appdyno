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
  withFamily,
  withShownWords,
  type Reads,
  type Sought,
} from '@appdyno/core';
import { DEFAULT_POLICY, ServerContext } from '@appdyno/ops';
import { DeviceError, SETTLE_DEFAULT, type Tree } from '@appdyno/protocol';
import { regularExpression } from './allow.js';
import { deviceProviders } from './providers.js';
import type {
  Aimed,
  Device,
  OpenOptions,
  Screen,
  ScreenElement,
  Selector,
  Touched,
} from './device-types.js';

export type * from './device-types.js';

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
    const { list, elements, hash, foreground, window } = buildScreen(tree, {
      port: device.platformScreen,
      ...(app && { appId: app }),
    });
    return {
      elements: withFamily(list, elements),
      hash,
      ...(foreground && { foreground }),
      ...(window && { window }),
    };
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
