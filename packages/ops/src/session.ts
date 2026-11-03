import {
  buildScreen,
  pause,
  throwIfCancelled,
  type Device,
  type Screen,
  type ScreenElement,
} from '@appdyno/core';
import { DeviceError, type Tree } from '@appdyno/protocol';
import { ToolError } from './tool.js';

const WAIT_GAP_MS = 300;

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
      if (!onDevice) await pause(WAIT_GAP_MS).catch(refused);
    }
  }

  /** The screen the agent was shown last: diffs are against it. */
  shown: ScreenElement[] | undefined;
  /** Device actions so far. */
  version = 0;
  private latest: { screen: Screen; at: number } | undefined;
  /** The version and layout of the last screenshot sent. */
  shot: { at: number; hash: string } | undefined;

  constructor(
    readonly device: Device,
    public appId: string | undefined,
  ) {}

  screenOf(tree: Tree): Screen {
    return buildScreen(tree, {
      platform: this.device.platform,
      ...(this.appId && { appId: this.appId }),
    });
  }

  /** A fresh read of the device, remembered as the newest. */
  async read(): Promise<Screen> {
    const screen = this.screenOf(await this.device.tree().catch(refused));
    this.remember(screen);
    return screen;
  }

  remember(screen: Screen) {
    this.latest = { screen, at: this.version };
  }

  /** The newest read when no action came after it, else a fresh one. */
  async current(): Promise<Screen> {
    if (this.latest && this.latest.at === this.version) return this.latest.screen;
    return this.read();
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

/** A device failure as the agent's error: what failed and what to do. */
export function refused(err: unknown): never {
  if (err instanceof ToolError) throw err;
  if (err instanceof DeviceError) {
    const hint =
      err.code === 'TIMEOUT'
        ? 'the device did not answer; read the screen and try again'
        : err.code === 'DEVICE_GONE' || err.code === 'AGENT_UNAVAILABLE'
          ? 'the device is not connected or its agent stopped; try once more'
          : err.code === 'NO_FOCUS'
            ? 'no editable field has the focus: tap the field first (or give type_text a ref)'
            : (err.hint ?? 'the device refused the command');
    throw new ToolError(`${err.message} (${err.code}): ${hint}`, err.code, hint);
  }
  throw err;
}
