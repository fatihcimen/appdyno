import {
  buildScreen,
  DeviceQueue,
  pause,
  throwIfCancelled,
  type Device,
  type Owner,
  type Screen,
  type ScreenElement,
} from '@appdyno/core';
import type { Tree } from '@appdyno/protocol';

const WAIT_GAP_MS = 300;
/** A phone locks itself about a minute after the last touch: an older read says nothing of the screen a touch will reach. */
const LOOK_MS = 20_000;

/** A read this recent is what the device shows: a client that reads and at once acts pays for one read. */
const FRESH_MS = 150;

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
    let onDevice = !!this.device.waitChange;
    for (;;) {
      throwIfCancelled('wait');
      let now: Screen | undefined;
      if (onDevice) {
        const left = Math.max(0, end - Date.now());
        // a failed or absent wait: poll for the rest of this call
        const r = await this.device.waitChange!(sig, sig === undefined ? 0 : left).catch(
          () => undefined,
        );
        if (r === undefined) onDevice = false;
        else {
          sig = r.sig;
          if (r.tree) {
            // no app window: a dark screen, which only the device's own read wakes
            now = r.tree.windows.some((w) => w.type === 1)
              ? this.screenOf(r.tree)
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

  /** The screen the agent was shown last: diffs are against it. */
  shown: ScreenElement[] | undefined;
  /** Device actions so far. */
  version = 0;
  private latest: { screen: Screen; at: number; taken: number } | undefined;
  /** The version and layout of the last screenshot sent. */
  shot: { at: number; hash: string } | undefined;

  /** Changes to the device's conditions, one at a time: each reads, asks the device, then writes. */
  readonly conditions = new DeviceQueue();

  constructor(
    readonly device: Device,
    public appId: string | undefined,
    /** Who answers for what this session leaves on the device; a command line's stays until asked. */
    readonly owner?: Owner,
  ) {}

  screenOf(tree: Tree): Screen {
    return buildScreen(tree, {
      platform: this.device.platform,
      ...(this.appId && { appId: this.appId }),
    });
  }

  /** A fresh read of the device, remembered as the newest. */
  async read(): Promise<Screen> {
    // a read that fails has seen nothing: what was read before it says nothing of a screen that now refuses
    const tree = await this.device.tree().catch((e: unknown) => {
      this.latest = undefined;
      throw e;
    });
    const screen = this.screenOf(tree);
    this.remember(screen);
    return screen;
  }

  remember(screen: Screen) {
    this.latest = { screen, at: this.version, taken: Date.now() };
  }

  /** The newest read when no action came after it, else a fresh one. */
  async current(): Promise<Screen> {
    if (this.latest && this.latest.at === this.version) return this.latest.screen;
    return this.read();
  }

  /**
   * What a touch aims by: the screen just now. An app may move things with no action of ours (a row it adds
   * seconds after its launch), and an element is touched where it is, not where an older answer had it.
   */
  async justNow(): Promise<Screen> {
    const l = this.latest;
    return l && l.at === this.version && Date.now() - l.taken < FRESH_MS ? l.screen : this.read();
  }

  /**
   * A look at the screen before a touch, unless one was just taken: what a device refuses, it refuses here (a locked
   * phone, no window), and nothing reaches a screen nobody has seen.
   */
  async beforeTouch() {
    if (!this.fresh || Date.now() - this.latest!.taken > LOOK_MS) await this.read();
  }

  /** The newest read when it is still the device's screen (no action since), else undefined. */
  get fresh(): Screen | undefined {
    return this.latest && this.latest.at === this.version ? this.latest.screen : undefined;
  }

  /** The app's process when last looked: another one means it went down and came back. */
  appPid: string | undefined;
  /** When the last device action ended (epoch ms): `logs` starts here. */
  lastActionAt: number | undefined;

  /** A device action happened: refs read before it are resolved on a new read. */
  acted() {
    this.version++;
    this.lastActionAt = Date.now();
  }
}
