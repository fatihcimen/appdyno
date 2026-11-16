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
  shownLabel,
  touchPoint,
  waitUntil,
  withFamily,
  withShownWords,
  type ActOptions,
  type Reads,
  type ScreenElement as Listed,
  type Sought,
} from '@appdyno/core';
import { checkApp, redact, ServerContext } from '@appdyno/ops';
import {
  DeviceError,
  Settle,
  SETTLE_DEFAULT,
  type ActResult,
  type Traversal,
  type Tree,
} from '@appdyno/protocol';
import { policyFor, signingOf } from './allow.js';
import { membersOf } from './device-members.js';
import { deviceProviders } from './providers.js';
import type {
  Aimed,
  Device,
  OpenOptions,
  Screen,
  ScreenElement,
  Selector,
  Touched,
  TouchOptions,
} from './device-types.js';

export type * from './device-types.js';

/**
 * A touch's options as a device takes them: it waits for the screen to come to rest, by the device's own measure, for
 * as long as the wire lets a caller ask.
 */
function acts({ before, quietMs, maxMs, tree }: TouchOptions = {}): ActOptions {
  const settle = {
    ...(quietMs !== undefined && { quietMs }),
    ...(maxMs !== undefined && { maxMs }),
  };
  if (!Settle.safeParse(settle).success)
    throw new DeviceError(
      'INVALID_ARGUMENT',
      'quietMs is a whole number of ms from 0 to 5000, and maxMs one from 0 to 15000',
    );
  return {
    settle,
    ...(before !== undefined && { before }),
    ...(tree && { read: 'tree' as const }),
  };
}

/**
 * A device by its serial, opened by the driver that takes it and held for this process until `close`: one another
 * process holds is refused `DEVICE_CLAIMED`, and one `allowDevices` does not name `POLICY_DENIED`.
 */
export async function openDevice(serial: string, options: OpenOptions = {}): Promise<Device> {
  const { app, share = false } = options;
  const policy = policyFor(options);
  const clean = (text: string) => redact(policy, text);
  const device = new ServerContext(
    policy,
    deviceProviders(false, undefined, undefined, {}, signingOf(options.signing)),
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
  const reads = { port: device.platformScreen, ...(app && { appId: app }) };
  const shown = (tree: Tree, traversal?: Traversal[]): Screen => {
    const { list, elements, hash, foreground, window } = buildScreen(tree, reads, traversal);
    return {
      elements: withFamily(list, elements).map((e) => hidden(e, clean)),
      hash,
      ...(foreground && { foreground }),
      ...(window && { window }),
    };
  };
  const screen = async () => shown(await device.tree());
  /** What an action answered, with the screen it left where that was asked: the one its settle read, else a new read. */
  const touched = async (r: ActResult, o: TouchOptions = {}): Promise<Touched> => ({
    settled: r.settle?.settled === true,
    ...(r.settle && { ms: r.settle.ms }),
    ...(o.tree && { tree: r.tree ? shown(r.tree) : await screen() }),
  });
  /** A launch's or a link's screen come to rest, by reads: one right after catches a screen still laying out. */
  const rested = async (o: TouchOptions = {}): Promise<Touched> => {
    const { settle = {} } = acts(o);
    const { quietMs, maxMs } = { ...SETTLE_DEFAULT, ...settle };
    const r = await settleBy(screen, quietMs, maxMs, o.before);
    return { settled: r.settled, ms: r.ms, ...(o.tree && { tree: r.screen }) };
  };
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
    tap: async (at, o) => touched(await device.tap(at, acts(o)), o),
    longPress: async (at, ms, o) => touched(await device.longPress(at, ms, acts(o)), o),
    swipe: async (from, to, ms, o) => touched(await device.swipe(from, to, ms, acts(o)), o),
    key: async (key, o) => touched(await device.key(key, acts(o)), o),
    async typeText(text, { at, replace, submit, ...o } = {}) {
      const r = await device.typeText(text, {
        ...acts(o),
        ...(at && { at }),
        ...(replace !== undefined && { replace }),
        ...(submit !== undefined && { submit }),
      });
      return {
        ...(await touched(r, o)),
        ...(r.verified !== undefined && { verified: r.verified }),
        ...(r.submitted !== undefined && { submitted: r.submitted }),
      };
    },
    async launch(id, o) {
      acts(o);
      await device.launch(checkApp(policy, id));
      return rested(o);
    },
    terminate: async (id) => device.terminate(checkApp(policy, id)),
    foreground: () => device.foreground(),
    aim: async (target, { waitMs = AIM_WAIT_MS } = {}) =>
      aimed(await seek({ now: screen, until }, target, READS, waitMs), target),
    ...membersOf({ device, policy, app, reads, clean, shown, screen, rested, letGo }),
    close() {
      letGo();
      return Promise.resolve();
    },
  };
}

/**
 * An element as this entry gives it: the fields its type names and no other, as the model's own names for it hold its
 * words too, with the caller's secrets hidden in its words and its id. Whole first, then cut, so no cut shows a part.
 */
function hidden(
  { name: _name, nameKind: _kind, context: _context, refContext: _row, ...e }: Listed,
  clean: (text: string) => string,
): ScreenElement {
  return {
    ...e,
    label: shownLabel(e, clean),
    ...(e.whole !== undefined && { whole: clean(e.whole) }),
    ...(e.id !== undefined && { id: clean(e.id) }),
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
