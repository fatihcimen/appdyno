import { execFile } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import {
  deviceStateFile,
  NeedError,
  type DeviceState,
  type InputEvent,
  type Mirror,
  type MirrorCheck,
  type MirrorOptions,
  type MirrorSource,
  type Need,
} from '@appdyno/core';
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

/** A stream that ended for this need is not tried again for this long, however often it is checked. */
const RETRY_NEED_MS = 3_000;

/** An iPhone's mirror: all it speaks is in the stream it loads, and only what a session asks is here. */
export class PhoneMirror implements Mirror {
  readonly sendsWhenStill = true;
  private module: PhoneStreamModule | undefined;
  private handle: PhoneStreamHandle | undefined;
  private watchers: ((s: DeviceState) => void)[] = [];
  private blocked: { need: Need; detail: string; until: number } | undefined;
  private attaches = 0;
  private live: { w: number; h: number; mode: string } | undefined;

  constructor(
    private readonly udid: string,
    private readonly load: () => Promise<PhoneStreamModule | undefined> = loadPhoneStream,
    private readonly makePipe: (file: string) => Promise<void> = async (file) => {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      rmSync(file, { force: true });
      await run('/usr/bin/mkfifo', ['-m', '600', file]);
    },
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
      if (e.kind === 'state') this.tell(e.state);
      if (e.kind === 'lost' || e.kind === 'ended') this.handle = undefined;
      if (e.kind === 'lost') {
        if (e.need) {
          this.blocked = { need: e.need, detail: e.why, until: this.now() + RETRY_NEED_MS };
        }
        this.tell(e.need ?? 'not-connected');
      }
    });
  }

  async open(options: MirrorOptions): Promise<MirrorSource> {
    const stream = await this.stream();
    if (!stream) throw new NeedError('no-phone-stream');
    const file = deviceStateFile('mirror', `${this.udid}-frames-${process.pid}-${this.attaches++}`);
    await this.makePipe(file);
    this.handle ??= this.begin(stream, options);
    this.handle.attach(file);
    return { kind: 'pipe', file, codec: 'hevc' };
  }

  async keyframe() {
    this.handle?.keyframe();
  }

  async input(e: InputEvent) {
    this.handle?.input(e);
  }

  async close() {
    const handle = this.handle;
    this.handle = undefined;
    if (handle) await handle.stop();
  }

  watch(onChange: (s: DeviceState) => void) {
    this.watchers.push(onChange);
    return () => {
      this.watchers = this.watchers.filter((w) => w !== onChange);
    };
  }
}
