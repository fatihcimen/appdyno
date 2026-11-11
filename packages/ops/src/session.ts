import { AsyncLocalStorage } from 'node:async_hooks';
import {
  buildScreen,
  DeviceQueue,
  must,
  opStartedAt,
  pause,
  readPicture,
  SLIDE_DROPS_TOUCH,
  throwIfCancelled,
  TRANSITION_MS,
  withPictureText,
  type Device,
  type Owner,
  type PictureWords,
  type Screen,
  type ScreenElement,
} from '@appdyno/core';
import type { Tree } from '@appdyno/protocol';
import { appInFront } from './apps-guard.js';
import { guardInputs, type InputGuard } from './power.js';
import type { RunningFlight } from './timeline/flight.js';
import type { RunningTimeline } from './timeline/run.js';

const WAIT_GAP_MS = 300;
/** Reads apart while a screen settles after a launch or a link: a simulator's helper reads in 15-30 ms. */
const SETTLE_POLL_MS = 40;
/** A phone locks itself about a minute after the last touch: an older read says nothing of the screen a touch will reach. */
const LOOK_MS = 20_000;

/** A read this recent is what the device shows: a client that reads and at once acts pays for one read. */
const FRESH_MS = 150;

type Latest = { screen: Screen; at: number; taken: number };

/**
 * One device the server drives and what its agent was shown: the screen the diffs are against, the
 * newest read (refs resolve on it while no action came after it) and a count of actions.
 */
export class Session {
  /**
   * Reads until `met` holds or the time is up, the last read with it. On the device where the agent has
   * `wait`, so the tree crosses only when the screen changed; else a read every WAIT_GAP_MS.
   */
  async until(
    met: (s: Screen) => boolean,
    timeoutMs: number,
  ): Promise<{ screen?: Screen; met: boolean }> {
    const end = Date.now() + timeoutMs;
    let last: Screen | undefined;
    let sig: string | undefined;
    let onDevice = true;
    for (;;) {
      throwIfCancelled('wait');
      let now: Screen | undefined;
      // what changes on a picture changes nothing a device could wait on
      if (this.wordless) onDevice = false;
      if (onDevice) {
        const left = Math.max(0, end - Date.now());
        // a failed or absent wait: poll for the rest of this call
        const r = await this.device
          .waitChange(sig, sig === undefined ? 0 : left)
          .catch(() => undefined);
        if (r === undefined) onDevice = false;
        else {
          sig = r.sig;
          if (r.tree) {
            // no app window: a dark screen, which only the device's own read wakes
            now = r.tree.windows.some((w) => w.type === 1)
              ? await this.seen(r.tree)
              : await this.read().catch(() => undefined);
            if (now) this.remember(now);
          } else if (last) return { screen: last, met: false };
        }
      }
      // a failed read is no answer: never "gone"
      if (!onDevice) now = await this.read().catch(() => undefined);
      if (now) {
        last = now;
        if (met(now)) return { screen: now, met: true };
      }
      if (Date.now() >= end) return { ...(last && { screen: last }), met: false };
      if (!onDevice) await pause(WAIT_GAP_MS);
    }
  }

  /**
   * Reads until the screen's layout has held for `quietMs`, at most `maxMs` (after a launch or a link), by an action's
   * settle's rule: a read of another layout starts the window again, other words in the same layout do not, and a read
   * proves the layout still up to when it began. Reads come SETTLE_POLL_MS apart, so a read's own time counts towards
   * the window. Not by the device's `wait`: on a simulator that is the runner's, far slower than its helper's reads.
   */
  async settle(quietMs: number, maxMs: number): Promise<{ screen: Screen; settled: boolean }> {
    const end = Date.now() + maxMs;
    let screen: Screen | undefined;
    let changedAt = 0;
    for (;;) {
      throwIfCancelled('settle');
      if (screen) await pause(Math.min(SETTLE_POLL_MS, Math.max(0, end - Date.now())));
      const readAt = Date.now();
      const next = await this.read();
      if (next.hash !== screen?.hash) changedAt = readAt;
      screen = next;
      if (readAt - changedAt >= quietMs) return { screen, settled: true };
      if (Date.now() >= end) return { screen, settled: false };
    }
  }

  /** What is recording for a timeline: its sources run in this process, and end with it. */
  timeline: RunningTimeline | undefined;
  /** The flight recorder of this device, for as long as a person keeps it on. */
  flight: RunningFlight | undefined;
  /** The screen the agent was shown last: diffs are against it. */
  shown: ScreenElement[] | undefined;
  /** Device actions so far. */
  version = 0;
  private latest: Latest | undefined;
  /** The newest read of the call it runs in, which a read of another call beside it leaves as it was. */
  private readonly own = new AsyncLocalStorage<{ latest: Latest | undefined }>();

  /** The newest read, for every call and for the one that made it. */
  private keep(latest: Latest | undefined) {
    this.latest = latest;
    const mine = this.own.getStore();
    if (mine) mine.latest = latest;
  }

  /**
   * `action`, and the newest read it made, else the one before it: the screen it aimed at, whatever a read beside it saw
   * meanwhile, as a read made after the touch already has the screen the touch opened.
   */
  async aiming<T>(action: () => Promise<T>): Promise<{ result: T; aimedAt: Screen | undefined }> {
    const mine = { latest: this.latest };
    const result = await this.own.run(mine, action);
    return { result, aimedAt: mine.latest?.at === this.version ? mine.latest.screen : undefined };
  }
  /** The version and layout of the last screenshot sent. */
  shot: { at: number; hash: string } | undefined;

  /** Changes to the device's conditions, one at a time: each reads, asks the device, then writes. */
  readonly conditions = new DeviceQueue();

  constructor(
    readonly device: Device,
    appId: string | undefined,
    /** Who answers for what this session leaves on the device; a command line's stays until asked. */
    readonly owner?: Owner,
    /** What every input passes on its way to the device, whichever tool, step or replay sent it. */
    guard?: InputGuard,
  ) {
    this.app = appId;
    if (guard) this.device = guardInputs(device, (input) => guard(this, input));
  }

  screenOf(tree: Tree): Screen {
    return buildScreen(tree, {
      port: this.device.platformScreen,
      ...(this.appId && { appId: this.appId }),
    });
  }

  /** The last read had no word in its tree: a game, a canvas, anything drawn. */
  wordless = false;
  /** Why such a screen's picture gave no words, if it failed. */
  pictureFailed: string | undefined;
  /** The level that read such a screen's picture. */
  pictureLevel: PictureWords['level'] | undefined;
  /** Reads a picture's words: a test has its own. */
  readWords = readPicture;

  /** A tree as a screen, with the words of its picture where it has none of its own. */
  async seen(tree: Tree): Promise<Screen> {
    const screen = this.screenOf(tree);
    this.wordless = !screen.list.some((e) => e.label);
    this.pictureFailed = undefined;
    if (!this.wordless) return screen;
    try {
      const shot =
        (await this.device.mirror.screenshot?.('png')) ??
        (await this.device.screenshot({ format: 'png' }));
      const size = screen.window ?? must(this.device.hello, "the agent's hello").screen;
      const { words, level } = await this.readWords(shot.data);
      this.pictureLevel = level;
      return this.screenOf(withPictureText(tree, words, size));
    } catch (e) {
      this.pictureFailed = (e as Error).message;
      return screen;
    }
  }

  /** A fresh read of the device, remembered as the newest. */
  async read(): Promise<Screen> {
    // a read that fails has seen nothing: what was read before it says nothing of a screen that now refuses
    const tree = await this.device.tree().catch((e: unknown) => {
      this.keep(undefined);
      throw e;
    });
    const screen = await this.seen(tree);
    this.remember(screen);
    return screen;
  }

  /** A read for what watches: a dark or locked screen stays as it is. */
  async look(): Promise<Screen> {
    const screen = await this.seen(await this.device.tree({ asItIs: true }));
    this.remember(screen);
    return screen;
  }

  /** The app last seen in front on a read, a prompt over it aside: what a prompt that stands alone in front is over. */
  shownApp: string | undefined;

  remember(screen: Screen) {
    this.keep({ screen, at: this.version, taken: Date.now() });
    this.shownApp = appInFront(screen.tree, this.device.platformScreen) ?? this.shownApp;
  }

  /** The newest read when no action came after it, else a fresh one. */
  async current(): Promise<Screen> {
    if (this.latest?.at === this.version) return this.latest.screen;
    return this.read();
  }

  /**
   * What a touch aims by: the screen just now. An app may move things with no action of ours (a row it adds
   * seconds after its launch), and an element is touched where it is, not where an older answer had it.
   */
  async justNow(): Promise<Screen> {
    const l = this.latest;
    return l?.at === this.version && Date.now() - l.taken < FRESH_MS ? l.screen : this.read();
  }

  /**
   * A look at the screen before a touch, unless one was just taken: what a device refuses, it refuses here (a locked
   * phone, no window), and nothing reaches a screen nobody has seen.
   */
  async beforeTouch() {
    if (!this.fresh || Date.now() - must(this.latest, 'the last read').taken > LOOK_MS)
      await this.read();
    const slid = this.unsettled;
    this.unsettled = undefined;
    // UIKit drops a touch during a slide, which no read nor the app's idle reports show: its remainder is the only sign
    if (SLIDE_DROPS_TOUCH[this.device.platform] && slid && slid.hash !== this.fresh?.hash)
      await pause(Math.max(0, slid.at + TRANSITION_MS - Date.now()));
  }

  /** The last touch skipped its settle: when it ended, and the screen it was aimed at. */
  unsettled: { at: number; hash: string | undefined } | undefined;

  /** The newest read when it is still the device's screen (no action since), else undefined. */
  get fresh(): Screen | undefined {
    return this.latest?.at === this.version ? this.latest.screen : undefined;
  }

  // what tells a death from a leave: written only by what knows which it was
  private app: string | undefined;
  private left = false;
  private pid: string | undefined;

  /** The app this session drives, if one is selected. */
  get appId() {
    return this.app;
  }

  /** Selects the app this session drives, or none. */
  select(app: string | undefined) {
    this.app = app;
  }

  /** The app was left on purpose (a key, Settings, another app, a stop): out of the front, it did not crash. */
  get leftApp() {
    return this.left;
  }

  /** The app was left on purpose, or, with `false`, is in front again. */
  leftTheApp(left = true) {
    this.left = left;
  }

  /** The selected app's process when last looked: another one means it went down and came back. */
  get appPid() {
    return this.pid;
  }

  /** The process `app` was found with, kept where it is the selected one. */
  sawProcess(app: string, pid: string | undefined) {
    if (app === this.app) this.pid = pid;
  }

  /** A launch, a link or a measure may start the app anew: the next action asks for its process again. */
  forgetProcess() {
    this.pid = undefined;
  }

  /** When the op of the last device action began (epoch ms): `logs` starts there, with what it set off. */
  lastActionAt: number | undefined;

  /** A device action happened: refs read before it are resolved on a new read. */
  acted() {
    this.version++;
    this.lastActionAt = opStartedAt() ?? Date.now();
  }
}
