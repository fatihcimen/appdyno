import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DeviceState,
  InputEvent,
  Mirror,
  MirrorCheck,
  MirrorOptions,
  MirrorSource,
} from '@appdyno/core';
import type { Key } from '@appdyno/protocol';
import { Simctl, xcodeEnv } from './simctl.js';
import { startSimAx, startSimHid, type HelperProcess } from './simhelper.js';
import { HID_KEYS } from './simtouch.js';

const KEYBOARD = 7;
const SHIFT = 0xe1;
const COMMAND = 0xe3;
const V = 0x19;
const INPUT_MS = 8_000;
const SHOT_MS = 30_000;
const TURNS_CHECK_MS = 250;
/** How long a read helper that failed is left alone: at the slow end of a simulator shut down or a busy Mac. */
const TURNS_RETRY_MS = 5_000;

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
 * The quarter turns, counterclockwise, that stand up the surface of a simulator whose app in front has this
 * interface orientation; undefined for what says nothing of it.
 */
export function turnsOf(orientation: number): number | undefined {
  return { 1: 0, 2: 2, 3: 1, 4: 3 }[orientation];
}

/** A point of a picture stood up by these turns, as a fraction of the surface beneath it: where a touch goes. */
export function onSurface(x: number, y: number, turns: number): { x: number; y: number } {
  switch (turns) {
    case 1:
      return { x: 1 - y, y: x };
    case 2:
      return { x: 1 - x, y: 1 - y };
    case 3:
      return { x: y, y: 1 - x };
    default:
      return { x, y };
  }
}

/**
 * A simulator's mirror. The viewer reads its screen by itself, with nothing to ready here, so only input
 * goes through this process, by the helper that also sends a driven simulator's touches. A guest that turns
 * draws sideways in the same surface and nothing on the Mac says so, so its turns are asked of the read helper.
 */
export class SimulatorMirror implements Mirror {
  /** A still screen draws nothing, but the surface comes at once: silence means someone else has it. */
  readonly noFirstFrame = { ms: 3_000, need: 'presented-elsewhere' as const };
  private hid: Promise<HelperProcess> | undefined;
  private reader: Promise<HelperProcess> | undefined;
  private turns = 0;
  private turnsTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly udid: string,
    private readonly simctl: Simctl = new Simctl(),
    private readonly startHid: (udid: string) => Promise<HelperProcess> = startSimHid,
    private readonly paste: (udid: string, text: string) => Promise<void> = pasteboard,
    private readonly startReader: (udid: string) => Promise<HelperProcess> = startSimAx,
  ) {}

  async check(): Promise<MirrorCheck> {
    return (await this.simctl.state(this.udid)) === 'Booted'
      ? { ok: true, routes: ['surface'] }
      : { ok: false, need: 'simulator-off' };
  }

  /** One read at a time, and none for a while after one failed: the window then stays as it was last told. */
  private followTurns(tell: (message: Record<string, unknown>) => void) {
    clearInterval(this.turnsTimer);
    let notBefore = 0;
    this.turnsTimer = setInterval(() => {
      if (Date.now() < notBefore) return;
      notBefore = Infinity;
      void this.readTurns(tell).then(
        (ok) => (notBefore = ok ? 0 : Date.now() + TURNS_RETRY_MS),
        () => (notBefore = Date.now() + TURNS_RETRY_MS),
      );
    }, TURNS_CHECK_MS);
    this.turnsTimer.unref();
  }

  private async readTurns(tell: (message: Record<string, unknown>) => void) {
    const running = await this.reader?.catch(() => undefined);
    // closed meanwhile: a helper started now would have no one to end it
    if (!this.turnsTimer) return true;
    if (!running || running.closed) this.reader = this.startReader(this.udid);
    const a = await (await this.reader!).call({ op: 'orientation' }, INPUT_MS);
    const turns = turnsOf(a.orientation as number);
    if (turns !== undefined && turns !== this.turns) {
      this.turns = turns;
      tell({ op: 'turns', turns });
    }
    return a.ok;
  }

  async open(
    _opts?: MirrorOptions,
    _signal?: AbortSignal,
    tell: (message: Record<string, unknown>) => void = () => undefined,
  ): Promise<MirrorSource> {
    // up before a person's first touch, which would otherwise wait over a second for it
    void this.helper().catch(() => undefined);
    this.followTurns(tell);
    return {
      kind: 'surface',
      udid: this.udid,
      turns: this.turns,
      ...(xcodeEnv().DEVELOPER_DIR && { developerDir: xcodeEnv().DEVELOPER_DIR! }),
    };
  }

  async keyframe() {
    // nothing is encoded: each frame is the whole screen
  }

  private async helper() {
    const running = await this.hid?.catch(() => undefined);
    if (running && !running.closed) return running;
    this.hid = this.startHid(this.udid).then(async (h) => {
      // a touch sent first on a new connection was lost, where one after an answer was not
      await h.call({ op: 'ping' }, INPUT_MS);
      return h;
    });
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
      case 'touch': {
        const { x, y } = onSurface(e.x, e.y, this.turns);
        const second =
          e.x2 !== undefined && e.y2 !== undefined ? onSurface(e.x2, e.y2, this.turns) : undefined;
        await this.call({
          op: 'touch',
          quick: true,
          events: [{ ...e, x, y, ...(second && { x2: second.x, y2: second.y }), at: 0 }],
        });
        return;
      }
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

  /** Lossless and at once, where the runner's would first have to be built. */
  async screenshot(format: 'png' | 'jpeg') {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-shot-'));
    const file = join(dir, `shot.${format}`);
    try {
      await this.simctl.exec(['io', this.udid, 'screenshot', `--type=${format}`, file], SHOT_MS);
      return { data: readFileSync(file) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async close() {
    clearInterval(this.turnsTimer);
    this.turnsTimer = undefined;
    const helpers = [this.hid, this.reader];
    this.hid = this.reader = undefined;
    for (const h of helpers) (await h?.catch(() => undefined))?.close();
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
