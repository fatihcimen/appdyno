import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  imageSize,
  NeedError,
  pause,
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
  type ViewerOrder,
} from '@appdyno/core';
import { keyOfUsage, type DeviceError } from '@appdyno/protocol';
import { Devicectl } from './devicectl.js';
import { applePress, pasteKeys } from './mirror-press.js';
import { usageOf } from './simtouch.js';
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

/** Makes this Mac's own pairing for Wi-Fi, which a person accepts on the phone. */
export async function pairPhone(
  udid: string,
  say: (words: string) => void,
  load: () => Promise<PhoneStreamModule | undefined> = loadPhoneStream,
) {
  const stream = await load();
  if (!stream) throw new NeedError('no-phone-stream');
  await stream.pair(udid, say);
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

/** How long a paste's text stays on the phone's pasteboard with no touch, and after the touch that allows it. */
const RESTORE_MS = 60_000;
const AFTER_TOUCH_MS = 3_000;
const PROMPT_MS = 2_000;
/**
 * With no runner to ask, the one look at which field a tap gave the focus comes this long after it. Looks in a row kept
 * a field from the focus for 8.9 s, measured, in 3 rounds of 4, and one look at 3 s saw it, 4 of 4.
 */
const LOOK_AFTER_MS = 3_000;
/** This close to the last tap, as a share of the screen, is the same field: closer than two fields stand. */
const SAME_FIELD = 0.03;
const NOT_TRUE =
  "These letters went by key position, so the phone's keyboard layout decides what they become: the device agent types them true.";

type Spot = { x: number; y: number };
type Tap = Spot & { at: number };

/** What a runner does for a window. */
export type PhoneRunner = {
  /** A point of the text field under a share of the screen; false: none; undefined: it cannot say. */
  fieldAt(x: number, y: number): Promise<Spot | false | undefined>;
  /** Types any character, into the field at `into` once it has the focus, or refuses with NO_FOCUS. */
  keys(text: string, into?: Spot): Promise<void>;
};

/** What a person should know of a picture that comes this way. */
const ON_WIFI =
  'On Wi-Fi: the picture is the lower mode, and frames and touches take the longer way. A cable gives more.';

/** An iPhone's mirror: all it speaks is in the stream it loads, and only what a session asks is here. */
export class PhoneMirror implements Mirror {
  private say: (text: string) => void = () => undefined;
  private afterTouch: (() => void) | undefined;
  private typing: Promise<void> = Promise.resolve();
  /** The last tap that no letters have followed. */
  private tap: Tap | undefined;
  /** Letters not yet on their way, which more can join. */
  private gathering: { s: string } | undefined;
  /** No field took what was typed: nothing goes until the next tap, or the rest of it would reach the old field. */
  private closed = false;
  /** Letters waiting their turn: a touch after them stays after them, or they reach the next field. */
  private waiting = 0;
  /** This press came behind letters, and its moves and its lift stay with it. */
  private behind = false;
  /** The field the last look named, and where it was tapped: with no runner, nothing else tells a tap on the same one. */
  private named: (Spot & { name: string }) | undefined;
  /** No runner to be had: keys, which the phone's layout decides, with a word to say so. */
  private keysOnly = false;
  readonly sendsWhenStill = true;
  readonly wifi = true;
  /** A start lights the screen: it would turn back on a phone a person has just turned off. */
  readonly holdsThrough = 'asleep' as const;
  readonly keyOf = keyOfUsage;
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
    private readonly wait: (ms: number) => Promise<void> = pause,
    private readonly runner?: PhoneRunner,
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

  async check(options?: MirrorOptions): Promise<MirrorCheck> {
    const stream = await this.stream();
    if (!stream) return { ok: false, need: 'no-phone-stream' };
    if (this.dark) return { ok: false, need: 'asleep' };
    if (this.blocked && this.now() < this.blocked.until) {
      return { ok: false, need: this.blocked.need, detail: this.blocked.detail };
    }
    const wifi = await stream.onWifi(this.udid, options?.wifi === true);
    const c = await stream.check(this.udid, { wifi });
    return c.ok ? { ok: true, routes: ['tunnel', ...(wifi ? ['wifi'] : [])] } : c;
  }

  private tell(s: DeviceState) {
    for (const w of this.watchers) w(s);
  }

  private begin(stream: PhoneStreamModule, options: MirrorOptions) {
    const { quality, wifi } = options;
    const handle = stream.start(this.udid, { quality, ...(wifi && { wifi }) }, (e) => {
      // a stream being stopped still speaks, and it is no longer the one this mirror is about
      if (handle !== this.handle) return;
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
    return handle;
  }

  async open(
    options: MirrorOptions,
    _signal?: AbortSignal,
    tell: (message: ViewerOrder) => void = () => undefined,
  ): Promise<MirrorSource> {
    this.say = (text) => tell({ op: 'note', text });
    const stream = await this.stream();
    if (!stream) throw new NeedError('no-phone-stream');
    const file = join(framesDir(), `${safeName(this.udid)}-${process.pid}-${this.attaches++}`);
    this.dropPipe();
    await this.makePipe(file);
    this.pipe = file;
    const wifi = await stream.onWifi(this.udid, options.wifi === true);
    this.handle ??= this.begin(stream, { ...options, wifi });
    this.handle.attach(file);
    return {
      kind: 'pipe',
      encoded: true,
      file,
      codec: 'hevc',
      ...(wifi && { note: ON_WIFI }),
    };
  }

  /** Only on a dark screen: the same press on a lit one goes to the home screen. */
  async wake() {
    if (this.dark) this.handle?.input({ kind: 'button', name: 'home' });
  }

  async keyframe() {
    this.handle?.keyframe();
  }

  /**
   * What no key types goes by the phone's pasteboard, as a person would, and what it held comes back. The phone asks a
   * person on its screen to allow the paste, so that waits for their next touch, or for a while. A secure field is left
   * alone: its text must not sit on a pasteboard.
   */
  private async paste(text: string) {
    const stream = await this.stream();
    const secure = await stream?.secureFocused(this.udid).catch(() => undefined);
    if (secure !== false) {
      this.say(
        secure
          ? 'This field is secure and this text has no keys: type it on the phone.'
          : 'The phone could not say if this field is secure, and this text has no keys: type it on the phone.',
      );
      return;
    }
    const ctl = new Devicectl(this.udid);
    const held = await ctl.readPasteboard().catch(() => '');
    await ctl.writePasteboard(text);
    await pasteKeys(async (next) => this.handle?.input(next));
    this.say(
      `This text has no keys, so it went by the phone's pasteboard: allow the paste on its screen.${held ? '' : ' It held no text to put back.'}`,
    );
    const restore = () => {
      clearTimeout(timer);
      this.afterTouch = undefined;
      if (held) void ctl.writePasteboard(held).catch(() => undefined);
    };
    const timer = setTimeout(restore, RESTORE_MS);
    timer.unref();
    // a touch before the phone has asked is not the answer, and putting the text back then would paste the old one
    const asked = this.now() + PROMPT_MS;
    this.afterTouch = () => {
      if (this.now() < asked) return;
      clearTimeout(timer);
      setTimeout(restore, AFTER_TOUCH_MS).unref();
    };
  }

  private refuse() {
    this.closed = true;
    this.say('That did not go in: no field took it. Tap the field and type it again.');
  }

  /**
   * With nothing to say what is under a tap, letters go only if one look, late, names a field, and another than the last
   * unless the tap was on it: a keyboard stays up for a tap from one field to the next, and a secret went to the old one.
   */
  private async fieldTook(tap: Tap) {
    await this.wait(tap.at + LOOK_AFTER_MS - this.now());
    const stream = await this.stream();
    const name = await stream?.focusedField(this.udid).catch(() => undefined);
    const was = this.named;
    const moved = name !== was?.name;
    if (name && (moved || (was && Math.hypot(tap.x - was.x, tap.y - was.y) <= SAME_FIELD))) {
      this.named = { name, x: tap.x, y: tap.y };
      return true;
    }
    this.refuse();
    return false;
  }

  /** By the runner where there is one, so that the letters are the ones given; a tap's field is named, and none other gets them. */
  private async send(letters: { s: string }, tap: Tap | undefined) {
    const { runner } = this;
    const asked = runner && !this.keysOnly && tap;
    const under = asked ? await runner.fieldAt(tap.x, tap.y).catch(() => undefined) : undefined;
    if (tap && under === undefined && !(await this.fieldTook(tap))) return;
    if (this.gathering === letters) this.gathering = undefined;
    if (this.closed) return;
    if (runner && !this.keysOnly) {
      const failed = await runner.keys(letters.s, under || undefined).catch((e: Error) => e);
      if (!failed) return;
      if ((failed as DeviceError).code === 'NO_FOCUS') return this.refuse();
      this.keysOnly = true;
      this.say(NOT_TRUE);
    }
    const keyless = [...letters.s].some((c) => !usageOf(c));
    await (keyless ? this.paste(letters.s) : this.handle?.input({ kind: 'text', s: letters.s }));
  }

  async input(e: InputEvent) {
    if (e.kind === 'touch') {
      if (e.p === 0) {
        this.tap = { x: e.x, y: e.y, at: this.now() };
        this.gathering = undefined;
        this.closed = false;
        this.behind = this.waiting > 0;
      }
      if (e.p === 2) this.afterTouch?.();
      // the whole press, or a lift held behind letters that wait for this tap's focus would hold that focus back
      if (this.behind) {
        this.typing = this.typing.then(() => this.handle?.input(e));
        return;
      }
    }
    if (e.kind === 'button' && (await applePress(e.name, (next) => this.input(next)))) return;
    // what is typed waits its turn behind reads that take seconds, which must not hold up a touch: it may be the one
    // that answers the phone's prompt
    if (e.kind === 'text') {
      if (this.closed) return;
      if (this.gathering) {
        this.gathering.s += e.s;
        return;
      }
      const letters = (this.gathering = { s: e.s });
      const { tap } = this;
      this.tap = undefined;
      // a paste's own wait lets touches past, as one of them is what answers the phone
      const pasted = (this.keysOnly || !this.runner) && [...e.s].some((c) => !usageOf(c));
      if (!pasted) this.waiting++;
      this.typing = this.typing
        .then(() => this.send(letters, tap))
        .catch((failed: Error) => this.say(`That text did not go in: ${failed.message}`))
        .finally(() => {
          if (!pasted) this.waiting--;
        });
      return;
    }
    if (e.kind === 'key') {
      await this.typing;
      if (this.closed) return;
    }
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
    if (!handle) return;
    this.stopProved = await handle.stop();
    if (!this.handle) this.dark = false;
  }

  watch(onChange: (s: DeviceState) => void) {
    this.watchers.push(onChange);
    return () => {
      this.watchers = this.watchers.filter((w) => w !== onChange);
    };
  }
}
