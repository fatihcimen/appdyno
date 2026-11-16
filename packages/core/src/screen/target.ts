import { pause, throwIfCancelled } from '../call.js';
import { selectIn, type Selectable, type Selector } from './select.js';
import { oneOf, type Touchable } from './touch.js';

/** Reads apart while a screen settles after a launch or a link: a simulator's helper reads in 15-30 ms. */
const SETTLE_POLL_MS = 40;

/**
 * Reads until the screen's layout has held for `quietMs`, at most `maxMs` (after a launch or a link), by an action's
 * settle's rule: a read of another layout starts the window again, other words in the same layout do not, and a read
 * proves the layout still up to when it began. Reads come SETTLE_POLL_MS apart, so a read's own time counts towards
 * the window. Not by the device's `wait`: on a simulator that is the runner's, far slower than its helper's reads.
 * `not`: a layout that is no rest however long it holds, as the screen a launch began on. `ms`: from the call to the
 * read it answers with.
 */
export async function settleBy<S extends { hash: string }>(
  read: () => Promise<S>,
  quietMs: number,
  maxMs: number,
  not?: string,
): Promise<{ screen: S; settled: boolean; ms: number }> {
  const began = Date.now();
  const end = began + maxMs;
  let screen: S | undefined;
  let changedAt = 0;
  for (;;) {
    throwIfCancelled('settle');
    if (screen) await pause(Math.min(SETTLE_POLL_MS, Math.max(0, end - Date.now())));
    const readAt = Date.now();
    const next = await read();
    if (next.hash !== screen?.hash) changedAt = readAt;
    screen = next;
    const ms = Date.now() - began;
    if (next.hash !== not && readAt - changedAt >= quietMs) return { screen, settled: true, ms };
    if (Date.now() >= end) return { screen, settled: false, ms };
  }
}

/** A wait's reads apart, where the device cannot wait for a change itself. */
const WAIT_GAP_MS = 300;

/**
 * Where a wait's screens come from. `read`: a new read, none where it failed, which is no answer. `changed`: the
 * device's own wait until the screen differs from `since`, with the screen it then shows, or `unchanged` when the time
 * ran out first; undefined where the device cannot wait itself, and the rest of the wait is reads.
 */
export type WaitSource<S> = {
  read(): Promise<S | undefined>;
  changed?(
    since: string | undefined,
    timeoutMs: number,
  ): Promise<{ sig: string; screen?: S | undefined; unchanged?: boolean } | undefined>;
};

/**
 * Screens until `met` holds or the time is up, the last one with it. On the device where it can wait, so a tree
 * crosses only when the screen changed; else a read every WAIT_GAP_MS.
 */
export async function waitUntil<S>(
  from: WaitSource<S>,
  met: (s: S) => boolean,
  timeoutMs: number,
): Promise<{ screen?: S; met: boolean }> {
  const end = Date.now() + timeoutMs;
  let last: S | undefined;
  let sig: string | undefined;
  let onDevice = true;
  for (;;) {
    throwIfCancelled('wait');
    let now: S | undefined;
    if (onDevice) {
      const left = Math.max(0, end - Date.now());
      // a failed or absent wait: poll for the rest of this call
      const r = await from.changed?.(sig, sig === undefined ? 0 : left);
      if (r === undefined) onDevice = false;
      else {
        sig = r.sig;
        if (!r.unchanged) now = r.screen;
        else if (last) return { screen: last, met: false };
      }
    }
    if (!onDevice) now = await from.read();
    if (now) {
      last = now;
      if (met(now)) return { screen: now, met: true };
    }
    if (Date.now() >= end) return { ...(last && { screen: last }), met: false };
    if (!onDevice) await pause(WAIT_GAP_MS);
  }
}

/** What a touch names its element by. */
export type Target = { ref: string } | Selector;

/** The screen just now, and a wait on it: what a session or a device gives an aim. */
export type Reader<S> = {
  now(): Promise<S>;
  until(met: (s: S) => boolean, timeoutMs: number): Promise<{ screen?: S; met: boolean }>;
};

/** How a read gives its elements: the list a selector names one of, and the element of a ref. */
export type Reads<S, E> = { list(screen: S): E[]; byRef(screen: S, ref: string): E | undefined };

/**
 * The one element a target names on a read, with the list it is one of, or why none: `ref`, the ref is not there;
 * `none`, nothing matches the selector; `index`, its index is past the last of `hits`; `several`, `hits` stand apart
 * and no index picks one; `unread`, no read came back.
 */
export type Sought<S, E> =
  | { element: E; list: E[]; screen: S }
  | { miss: 'ref' | 'none' | 'index' | 'several' | 'unread'; hits: E[]; screen?: S };

type Aimable = Touchable & Selectable;

/** The one of a selector's matches it names, or why none. */
export function chosen<E extends Aimable>(
  hits: E[],
  index?: number,
): { element: E } | { miss: 'none' | 'index' | 'several' } {
  if (hits.length === 0) return { miss: 'none' };
  if (index !== undefined && index >= hits.length) return { miss: 'index' };
  const element = oneOf(hits, index);
  return element ? { element } : { miss: 'several' };
}

/** A target on one read, as it stands. */
export function seekOn<S, E extends Aimable>(
  screen: S,
  target: Target,
  reads: Reads<S, E>,
): Sought<S, E> {
  const list = reads.list(screen);
  if ('ref' in target) {
    const element = reads.byRef(screen, target.ref);
    return element ? { element, list, screen } : { miss: 'ref', hits: [], screen };
  }
  const hits = selectIn(list, target);
  const one = chosen(hits, target.index);
  return 'element' in one ? { ...one, list, screen } : { ...one, hits, screen };
}

/**
 * A target on the screen just now, and where it is not there, on the screens of the next `waitMs`: a read on a loaded
 * device, or of an app not answering, can come back short of what the last one listed, and a screen may still be
 * coming. A selector is found on a new read; a ref on the one just taken, where it is there.
 */
export async function seek<S, E extends Aimable>(
  reader: Reader<S>,
  target: Target,
  reads: Reads<S, E>,
  waitMs: number,
): Promise<Sought<S, E>> {
  const there = (x: S) => 'element' in seekOn(x, target, reads);
  if ('ref' in target) {
    const first = await reader.now();
    if (there(first)) return seekOn(first, target, reads);
    return seekOn((await reader.until(there, waitMs)).screen ?? first, target, reads);
  }
  const matches = (x: S) => selectIn(reads.list(x), target).length > 0;
  const { screen } = await reader.until(matches, waitMs);
  return screen ? seekOn(screen, target, reads) : { miss: 'unread', hits: [] };
}
