import { spawn } from 'node:child_process';
import type { DeviceState, InputEvent, Mirror, MirrorCheck, MirrorSource } from '@appdyno/core';
import type { Key } from '@appdyno/protocol';
import { Simctl, xcodeEnv } from './simctl.js';
import { startSimHid, type HelperProcess } from './simhelper.js';
import { HID_KEYS } from './simtouch.js';

const KEYBOARD = 7;
const SHIFT = 0xe1;
const COMMAND = 0xe3;
const V = 0x19;
const INPUT_MS = 5_000;

const UNSHIFTED = "-=[]\\;'`,./";
const SHIFTED = '_+{}|:"~<>?';
const UNSHIFTED_USAGES = [0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38];
const SHIFTED_DIGITS = '!@#$%^&*()';

/** The usage and shift of a character a US keyboard types; undefined for any other. */
export function usageOf(c: string): { usage: number; shift: boolean } | undefined {
  const code = c.charCodeAt(0);
  if (c >= 'a' && c <= 'z') return { usage: 0x04 + code - 97, shift: false };
  if (c >= 'A' && c <= 'Z') return { usage: 0x04 + code - 65, shift: true };
  if (c >= '1' && c <= '9') return { usage: 0x1e + code - 49, shift: false };
  if (c === '0') return { usage: 0x27, shift: false };
  if (c === ' ') return { usage: 0x2c, shift: false };
  if (c === '\n') return { usage: 0x28, shift: false };
  const digit = SHIFTED_DIGITS.indexOf(c);
  if (digit >= 0) return { usage: 0x1e + digit, shift: true };
  const plain = UNSHIFTED.indexOf(c);
  if (plain >= 0) return { usage: UNSHIFTED_USAGES[plain]!, shift: false };
  const shifted = SHIFTED.indexOf(c);
  if (shifted >= 0) return { usage: UNSHIFTED_USAGES[shifted]!, shift: true };
  return undefined;
}

/**
 * A simulator's mirror. The viewer reads its screen by itself, with nothing to ready here, so only input
 * goes through this process, by the helper that also sends a driven simulator's touches.
 */
export class SimulatorMirror implements Mirror {
  /** A still screen draws nothing, but the surface comes at once: silence means someone else has it. */
  readonly noFirstFrame = { ms: 3_000, need: 'presented-elsewhere' as const };
  private hid: Promise<HelperProcess> | undefined;

  constructor(
    private readonly udid: string,
    private readonly simctl: Simctl = new Simctl(),
    private readonly startHid: (udid: string) => Promise<HelperProcess> = startSimHid,
    private readonly paste: (udid: string, text: string) => Promise<void> = pasteboard,
  ) {}

  async check(): Promise<MirrorCheck> {
    return (await this.simctl.state(this.udid)) === 'Booted'
      ? { ok: true, routes: ['surface'] }
      : { ok: false, need: 'simulator-off' };
  }

  async open(): Promise<MirrorSource> {
    return {
      kind: 'surface',
      udid: this.udid,
      ...(xcodeEnv().DEVELOPER_DIR && { developerDir: xcodeEnv().DEVELOPER_DIR! }),
    };
  }

  async keyframe() {
    // nothing is encoded: each frame is the whole screen
  }

  private async helper() {
    const running = await this.hid?.catch(() => undefined);
    if (running && !running.closed) return running;
    this.hid = this.startHid(this.udid);
    return this.hid;
  }

  private async call(request: Record<string, unknown>) {
    const a = await (await this.helper()).call(request, INPUT_MS);
    if (!a.ok) throw new Error(a.error ?? a.refused ?? 'the input helper failed');
  }

  private keyState(page: number, usage: number, state: 1 | 2) {
    return this.call({ op: 'keyState', page, usage, state });
  }

  private async press(usage: number, modifier?: number) {
    if (modifier) await this.keyState(KEYBOARD, modifier, 1);
    await this.keyState(KEYBOARD, usage, 1);
    await this.keyState(KEYBOARD, usage, 2);
    if (modifier) await this.keyState(KEYBOARD, modifier, 2);
  }

  /** Keys where the keyboard has them; anything else by the simulator's pasteboard, as a person would. */
  private async type(text: string) {
    const keys = [...text].map(usageOf);
    if (keys.every((k) => k)) {
      for (const k of keys) await this.press(k!.usage, k!.shift ? SHIFT : undefined);
      return;
    }
    await this.paste(this.udid, text);
    await this.press(V, COMMAND);
  }

  async input(e: InputEvent) {
    switch (e.kind) {
      case 'touch':
        await this.call({ op: 'touch', quick: true, events: [{ ...e, at: 0 }] });
        return;
      case 'key':
        await this.keyState(e.page, e.usage, e.state);
        return;
      case 'text':
        await this.type(e.s);
        return;
      case 'button': {
        const key = HID_KEYS[e.name as Key];
        if (key) await this.call({ op: 'key', ...key });
      }
    }
  }

  async close() {
    const hid = this.hid;
    this.hid = undefined;
    (await hid?.catch(() => undefined))?.close();
  }

  watch(_onChange: (s: DeviceState) => void) {
    // the viewer watches the simulator's state itself, and says `lost` when it goes
    return () => undefined;
  }
}

function pasteboard(udid: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('xcrun', ['simctl', 'pbcopy', udid], {
      stdio: ['pipe', 'ignore', 'ignore'],
      env: xcodeEnv(),
    });
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`simctl pbcopy exited with ${code}`)),
    );
    p.stdin.end(text);
  });
}
