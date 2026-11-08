import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type DeviceState,
  type InputEvent,
  type Mirror,
  type MirrorCheck,
  type MirrorOptions,
  type MirrorSource,
  type ViewerOrder,
  must,
} from '@appdyno/core';
import { type Key, KEY_USAGES, keyOfUsage } from '@appdyno/protocol';
import { applePress } from './mirror-press.js';
import { Simctl, xcodeEnv } from './simctl.js';
import { startSimAx, startSimHid, type HelperProcess } from './simhelper.js';
import { usageOf } from './simtouch.js';

const KEYBOARD = 7;
const SHIFT = 0xe1;
const COMMAND = 0xe3;
const V = 0x19;
const INPUT_MS = 8_000;
const SHOT_MS = 30_000;
const TURNS_CHECK_MS = 250;
/** How long a read helper that failed is left alone: at the slow end of a simulator shut down or a busy Mac. */
const TURNS_RETRY_MS = 5_000;

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

/** A touch of a picture stood up by these turns, as it goes to the surface beneath it. */
export function turnedTouch<T extends { x: number; y: number; x2?: number; y2?: number }>(
  e: T,
  turns: number,
): T {
  const second =
    e.x2 !== undefined && e.y2 !== undefined ? onSurface(e.x2, e.y2, turns) : undefined;
  return { ...e, ...onSurface(e.x, e.y, turns), ...(second && { x2: second.x, y2: second.y }) };
}

/**
 * A simulator's mirror. The viewer reads its screen by itself, with nothing to ready here, so only input
 * goes through this process, by the helper that also sends a driven simulator's touches. A guest that turns
 * draws sideways in the same surface and nothing on the Mac says so, so its turns are asked of the read helper.
 */
export class SimulatorMirror implements Mirror {
  /** A still screen draws nothing, but the surface comes at once: silence means someone else has it. */
  readonly noFirstFrame = { ms: 3_000, need: 'presented-elsewhere' as const };
  readonly keyOf = keyOfUsage;
  private hid: Promise<HelperProcess> | undefined;
  private reader: Promise<HelperProcess> | undefined;
  private turns = 0;
  private turnsTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly udid: string,
    private readonly simctl: Simctl = new Simctl(),
    private readonly startHid: (udid: string) => Promise<HelperProcess> = startSimHid,
    private readonly paste: (udid: string, text: string) => Promise<void> = (u, text) =>
      simctl.pbcopy(u, text),
    private readonly startReader: (udid: string) => Promise<HelperProcess> = startSimAx,
  ) {}

  async check(): Promise<MirrorCheck> {
    return (await this.simctl.state(this.udid)) === 'Booted'
      ? { ok: true, routes: ['surface'] }
      : { ok: false, need: 'simulator-off' };
  }

  /** One read at a time, and none for a while after one failed: the window then stays as it was last told. */
  private followTurns(tell: (message: ViewerOrder) => void) {
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

  private async readTurns(tell: (message: ViewerOrder) => void) {
    const running = await this.reader?.catch(() => undefined);
    // closed meanwhile: a helper started now would have no one to end it
    if (!this.turnsTimer) return true;
    if (!running || running.closed) this.reader = this.startReader(this.udid);
    const a = await (await must(this.reader, 'the reader')).call({ op: 'orientation' }, INPUT_MS);
    const turns = turnsOf(a.orientation as number);
    if (turns !== undefined && turns !== this.turns) {
      this.turns = turns;
      tell({ op: 'turns', turns });
    }
    return a.ok;
  }

  open(
    _opts?: MirrorOptions,
    _signal?: AbortSignal,
    tell: (message: ViewerOrder) => void = () => undefined,
  ): Promise<MirrorSource> {
    return new Promise((resolve) => {
      // up before a person's first touch, which would otherwise wait over a second for it
      void this.helper().catch(() => undefined);
      this.followTurns(tell);
      const developerDir = xcodeEnv().DEVELOPER_DIR;
      resolve({
        kind: 'surface',
        udid: this.udid,
        turns: this.turns,
        ...(developerDir && { developerDir }),
      });
    });
  }

  keyframe() {
    // nothing is encoded: each frame is the whole screen
    return Promise.resolve();
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
    // eslint-disable-next-line @typescript-eslint/no-misused-spread -- a key types one code point
    const keys = [...text].map(usageOf);
    if (keys.every((k) => k !== undefined)) {
      for (const k of keys) await this.press(k.usage, k.shift ? SHIFT : undefined);
      return;
    }
    await this.paste(this.udid, text);
    await this.press(V, COMMAND);
  }

  async input(e: InputEvent) {
    switch (e.kind) {
      case 'touch': {
        await this.call({
          op: 'touch',
          quick: true,
          events: [{ ...turnedTouch(e, this.turns), at: 0 }],
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
        if (await applePress(e.name, (next) => this.input(next))) return;
        const key = KEY_USAGES[e.name as Key];
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
