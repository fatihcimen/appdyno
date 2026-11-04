import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  NeedError,
  safeName,
  startOf,
  stateDir,
  type DeviceState,
  type InputEvent,
  type Mirror,
  type MirrorCheck,
  type MirrorOptions,
  type MirrorSource,
  type Need,
} from '@appdyno/core';
import { applePress, pasteKeys } from './mirror-press.js';
import { usageOf } from './mirror-sim.js';
import type { PhoneStreamHandle, PhoneStreamModule } from './phone-stream-port.js';

const run = promisify(execFile);

/** Reckoned at run time, so that this file builds with the folder gone, and only here does anything name it. */
const ENTRY = new URL('./phone-stream/index.js', import.meta.url).href;

/** Undefined with the folder gone; anything else that went wrong in it is not hidden. */
export async function loadPhoneStream(entry = ENTRY): Promise<PhoneStreamModule | undefined> {
  try {
    return ((await import(entry)) as { default: PhoneStreamModule }).default;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') return undefined;
    throw e;
  }
}

/** Width and height from an image's own header: PNG's first chunk, or JPEG's frame marker. */
export function imageSize(b: Buffer): { w: number; h: number } | undefined {
  if (b[0] === 0x89) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  for (let o = 2; o + 9 < b.length;) {
    const marker = b[o + 1]!;
    // a frame header, leaving out the three that are no frames
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { w: b.readUInt16BE(o + 7), h: b.readUInt16BE(o + 5) };
    }
    o += 2 + b.readUInt16BE(o + 2);
  }
  return undefined;
}

/** A folder of their own: a pipe nothing writes holds up whoever reads it, as a scan of a folder would. */
const framesDir = () => join(stateDir(), 'phone-frames');

/** A named pipe for a viewer, after taking away those of processes that are gone: a kill leaves one. */
async function makeFrames(file: string) {
  const dir = framesDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(dir)) {
    const pid = /-(\d+)-\d+$/.exec(name)?.[1];
    if (pid && startOf(Number(pid)) === '') rmSync(join(dir, name), { force: true });
  }
  await run('/usr/bin/mkfifo', ['-m', '600', file]);
}

/** A stream that ended for this need is not tried again for this long, however often it is checked. */
const RETRY_NEED_MS = 3_000;

/** An iPhone's mirror: all it speaks is in the stream it loads, and only what a session asks is here. */
/** How long a paste's text stays on the phone's pasteboard with no touch, and after the touch that allows it. */
const RESTORE_MS = 60_000;
const AFTER_TOUCH_MS = 1_500;

export class PhoneMirror implements Mirror {
  private say: (text: string) => void = () => undefined;
  private afterTouch: (() => void) | undefined;
  readonly sendsWhenStill = true;
  /** A start lights the screen: it would turn back on a phone a person has just turned off. */
  readonly holdsThrough = 'asleep' as const;
  private dark = false;
  private module: PhoneStreamModule | undefined;
  private handle: PhoneStreamHandle | undefined;
  private watchers: ((s: DeviceState) => void)[] = [];
  private blocked: { need: Need; detail: string; until: number } | undefined;
  private attaches = 0;
  private live: { w: number; h: number; mode: string } | undefined;
  private pipe: string | undefined;
  /** What the phone said of the last stop: that it ended, or nothing, leaving it to the phone's own timeout. */
  stopProved: boolean | undefined;

  constructor(
    private readonly udid: string,
    private readonly load: () => Promise<PhoneStreamModule | undefined> = loadPhoneStream,
    private readonly makePipe: (file: string) => Promise<void> = makeFrames,
    private readonly now: () => number = Date.now,
  ) {}

  private async stream() {
    this.module ??= await this.load();
    return this.module;
  }

  /** The screen with no runner; undefined with no stream in this build, or a phone that does not offer it. */
  async screenshot(format: 'png' | 'jpeg') {
    const stream = await this.stream();
    if (!stream) return undefined;
    const data = await stream.screenshot(this.udid, format).catch(() => undefined);
    const size = data && imageSize(data);
    return size && { meta: { ...size, format, bytes: data.length }, data };
  }

  async check(): Promise<MirrorCheck> {
    const stream = await this.stream();
    if (!stream) return { ok: false, need: 'no-phone-stream' };
    if (this.dark) return { ok: false, need: 'asleep' };
    if (this.blocked && this.now() < this.blocked.until) {
      return { ok: false, need: this.blocked.need, detail: this.blocked.detail };
    }
    const c = await stream.check(this.udid);
    return c.ok ? { ok: true, routes: ['tunnel'] } : c;
  }

  private tell(s: DeviceState) {
    for (const w of this.watchers) w(s);
  }

  private begin(stream: PhoneStreamModule, options: MirrorOptions) {
    return stream.start(this.udid, { quality: options.quality }, (e) => {
      if (e.kind === 'live') this.live = { w: e.w, h: e.h, mode: e.mode };
      if (e.kind === 'state') {
        this.dark = e.state === 'asleep';
        this.tell(e.state);
      }
      if (e.kind === 'lost' || e.kind === 'ended') {
        this.handle = undefined;
        this.dark = false;
      }
      if (e.kind === 'lost') {
        if (e.need) {
          this.blocked = { need: e.need, detail: e.why, until: this.now() + RETRY_NEED_MS };
        }
        this.tell(e.need ?? 'not-connected');
      }
    });
  }

  async open(
    options: MirrorOptions,
    _signal?: AbortSignal,
    tell: (message: Record<string, unknown>) => void = () => undefined,
  ): Promise<MirrorSource> {
    this.say = (text) => tell({ op: 'note', text });
    const stream = await this.stream();
    if (!stream) throw new NeedError('no-phone-stream');
    const file = join(framesDir(), `${safeName(this.udid)}-${process.pid}-${this.attaches++}`);
    this.dropPipe();
    await this.makePipe(file);
    this.pipe = file;
    this.handle ??= this.begin(stream, options);
    this.handle.attach(file);
    return { kind: 'pipe', file, codec: 'hevc' };
  }

  /** Only on a dark screen: the same press on a lit one goes to the home screen. */
  async wake() {
    if (this.dark) this.handle?.input({ kind: 'button', name: 'home' });
  }

  async keyframe() {
    this.handle?.keyframe();
  }

  private pasteboard(action: 'copy' | 'paste') {
    return run('xcrun', ['devicectl', 'device', 'pasteboard', action, '--device', this.udid]);
  }

  private async writePasteboard(text: string) {
    const copying = this.pasteboard('copy');
    copying.child.stdin?.end(text);
    await copying;
  }

  /**
   * What no key types goes by the phone's pasteboard, as a person would, and what it held comes back. The phone asks a
   * person on its screen to allow the paste, so that waits for their next touch, or for a while. A secure field is left
   * alone: its text must not sit on a pasteboard.
   */
  private async paste(text: string) {
    const stream = await this.stream();
    if (await stream?.secureFocused(this.udid).catch(() => false)) {
      this.say('This field is secure and this text has no keys: type it on the phone.');
      return;
    }
    const held = (await this.pasteboard('paste').catch(() => ({ stdout: '' }))).stdout;
    await this.writePasteboard(text);
    await pasteKeys((next) => this.input(next));
    this.say(
      `This text has no keys, so it went by the phone's pasteboard: allow the paste on its screen.${held ? '' : ' It held no text to put back.'}`,
    );
    const restore = () => {
      clearTimeout(timer);
      this.afterTouch = undefined;
      if (held) void this.writePasteboard(held).catch(() => undefined);
    };
    const timer = setTimeout(restore, RESTORE_MS);
    timer.unref();
    this.afterTouch = () => {
      clearTimeout(timer);
      setTimeout(restore, AFTER_TOUCH_MS).unref();
    };
  }

  async input(e: InputEvent) {
    if (e.kind === 'touch' && e.p === 2) this.afterTouch?.();
    if (e.kind === 'button' && (await applePress(e.name, (next) => this.input(next)))) return;
    if (e.kind === 'text' && [...e.s].some((c) => !usageOf(c))) return this.paste(e.s);
    this.handle?.input(e);
  }

  /** The stream takes a pipe off the disk once it holds it; one no viewer opened is still there. */
  private dropPipe() {
    if (this.pipe) rmSync(this.pipe, { force: true });
    this.pipe = undefined;
  }

  async close() {
    const handle = this.handle;
    this.handle = undefined;
    this.dropPipe();
    if (handle) this.stopProved = await handle.stop();
  }

  watch(onChange: (s: DeviceState) => void) {
    this.watchers.push(onChange);
    return () => {
      this.watchers = this.watchers.filter((w) => w !== onChange);
    };
  }
}
