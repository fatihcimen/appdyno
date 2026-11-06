import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NeedError, stateDir, type DeviceState } from '@appdyno/core';
import { imageSize } from '@appdyno/core';
import { loadPhoneStream, PhoneMirror } from '../src/mirror-phone.js';
import type { PhoneStreamEvent, PhoneStreamModule } from '../src/phone-stream-port.js';

const UDID = '00001234-0123456789ABCDEF';
const OPTIONS = { quality: 'auto' as const };

function fake(check: Awaited<ReturnType<PhoneStreamModule['check']>> = { ok: true }) {
  let onEvent: (e: PhoneStreamEvent) => void = () => undefined;
  const handle = {
    attach: vi.fn(),
    input: vi.fn(),
    keyframe: vi.fn(),
    stop: vi.fn(async () => true),
  };
  const module: PhoneStreamModule = {
    check: async () => check,
    screenshot: vi.fn(async () => {
      const png = Buffer.alloc(24);
      png[0] = 0x89;
      png.writeUInt32BE(100, 16);
      png.writeUInt32BE(200, 20);
      return png;
    }),
    elements: async () => [],
    press: async () => ({ caption: '' }),
    secureFocused: async () => false,
    live: async () => () => undefined,
    start: vi.fn((_udid, _options, listener) => {
      onEvent = listener;
      return handle;
    }),
  };
  const pipes: string[] = [];
  let now = 1000;
  const mirror = new PhoneMirror(
    UDID,
    async () => module,
    async (file) => void pipes.push(file),
    () => now,
  );
  return {
    mirror,
    handle,
    module,
    pipes,
    say: (e: PhoneStreamEvent) => onEvent(e),
    tick: (ms: number) => (now += ms),
  };
}

describe('text with no key on a phone', () => {
  it('holds up no touch while it reads the screen, and keys wait their turn', async () => {
    const { mirror, handle, module } = fake();
    let answer: (secure: boolean) => void = () => undefined;
    module.secureFocused = () => new Promise((resolve) => (answer = resolve));
    const told: Record<string, unknown>[] = [];
    await mirror.open({ quality: 'auto' }, undefined, (m) => told.push(m));
    await mirror.input({ kind: 'text', s: 'çay' });
    await mirror.input({ kind: 'touch', p: 0, x: 0.5, y: 0.5 });
    expect(handle.input).toHaveBeenCalledTimes(1);
    let keyed = false;
    const key = mirror.input({ kind: 'key', page: 7, usage: 4, state: 1 }).then(() => {
      keyed = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(keyed).toBe(false);
    answer(true);
    await key;
    expect(handle.input).toHaveBeenCalledTimes(2);
    expect(String(told[0]?.text)).toContain('secure');
  });

  it('sends nothing when it cannot tell whether a field is secure', async () => {
    const { mirror, handle, module } = fake();
    module.secureFocused = async () => {
      throw new Error('no service');
    };
    const told: Record<string, unknown>[] = [];
    await mirror.open({ quality: 'auto' }, undefined, (m) => told.push(m));
    await mirror.input({ kind: 'text', s: 'çay' });
    await mirror.input({ kind: 'key', page: 7, usage: 4, state: 2 });
    expect(handle.input).toHaveBeenCalledTimes(1);
    expect(String(told[0]?.text)).toContain('could not say');
  });
});

describe('the phone stream, gone from a build', () => {
  const absent = new PhoneMirror(UDID, async () => undefined);

  it('is a refusal in words, and the rest of the phone is not touched', async () => {
    await expect(absent.check()).resolves.toEqual({ ok: false, need: 'no-phone-stream' });
    await expect(absent.open(OPTIONS)).rejects.toBeInstanceOf(NeedError);
    await absent.input({ kind: 'touch', p: 0, x: 0, y: 0 });
    await absent.keyframe();
    await absent.close();
  });

  it('is what a lookup of a missing file comes to, and any other failure stays one', async () => {
    await expect(loadPhoneStream('file:///nowhere/index.js')).resolves.toBeUndefined();
    await expect(loadPhoneStream('data:text/javascript,throw new Error("broken")')).rejects.toThrow(
      'broken',
    );
  });
});

describe('the pipe to a viewer', () => {
  const dir = join(stateDir(), 'phone-frames');

  it('is no file of the mirror folder, and goes with a process that died', async () => {
    mkdirSync(dir, { recursive: true });
    const dead = join(dir, `${UDID}-999999-0`);
    const mine = join(dir, `${UDID}-${process.pid}-99`);
    writeFileSync(dead, '');
    writeFileSync(mine, '');
    const start = fake().module.start;
    const module = { ...fake().module, start };
    const mirror = new PhoneMirror(UDID, async () => module);
    const source = await mirror.open(OPTIONS);
    expect(source).toMatchObject({ kind: 'pipe' });
    const { file } = source as { file: string };
    expect(file.startsWith(`${dir}/`)).toBe(true);
    expect(statSync(file).isFIFO()).toBe(true);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(mine)).toBe(true);
    await mirror.close();
    expect(existsSync(file)).toBe(false);
    rmSync(mine);
  });
});

describe('a screenshot by the phone service', () => {
  it('has its size from its own header, either format', () => {
    const png = Buffer.alloc(24);
    png[0] = 0x89;
    png.writeUInt32BE(1284, 16);
    png.writeUInt32BE(2778, 20);
    expect(imageSize(png)).toEqual({ w: 1284, h: 2778 });
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x0a, 0xda, 0x05, 0x04, 0, 0,
    ]);
    expect(imageSize(jpeg)).toEqual({ w: 0x504, h: 0xada });
    expect(imageSize(Buffer.from([0xff, 0xd8]))).toBeUndefined();
  });

  it('answers with its image and size, nothing with no stream in the build, or a refusal', async () => {
    const { mirror, module } = fake();
    const shot = await mirror.screenshot('png');
    expect(shot?.meta).toEqual({ w: 100, h: 200, format: 'png', bytes: 24 });
    vi.mocked(module.screenshot).mockRejectedValueOnce(new Error('no service'));
    await expect(mirror.screenshot('png')).resolves.toBeUndefined();
    await expect(
      new PhoneMirror(UDID, async () => undefined).screenshot('png'),
    ).resolves.toBeUndefined();
  });
});

describe('a phone mirror', () => {
  it('passes on what its stream knows of the phone', async () => {
    await expect(fake().mirror.check()).resolves.toEqual({ ok: true, routes: ['tunnel'] });
    await expect(fake({ ok: false, need: 'not-trusted' }).mirror.check()).resolves.toMatchObject({
      ok: false,
      need: 'not-trusted',
    });
  });

  it('starts one stream, and gives each viewer a pipe of its own', async () => {
    const { mirror, module, handle, pipes } = fake();
    const first = await mirror.open(OPTIONS);
    expect(first).toEqual({ kind: 'pipe', encoded: true, file: pipes[0], codec: 'hevc' });
    const second = await mirror.open(OPTIONS);
    expect(pipes[1]).not.toBe(pipes[0]);
    expect(second).toMatchObject({ file: pipes[1] });
    expect(module.start).toHaveBeenCalledTimes(1);
    expect(handle.attach.mock.calls.map((c) => c[0])).toEqual(pipes);
    expect(module.start).toHaveBeenCalledWith(UDID, OPTIONS, expect.any(Function));
  });

  it('input, a key and a stop go to the stream, and a second stop to nothing', async () => {
    const { mirror, handle } = fake();
    await mirror.open(OPTIONS);
    const e = { kind: 'touch', p: 1, x: 0.5, y: 0.5 } as const;
    await mirror.input(e);
    await mirror.keyframe();
    expect(handle.input).toHaveBeenCalledWith(e);
    expect(handle.keyframe).toHaveBeenCalledTimes(1);
    await mirror.close();
    await mirror.close();
    expect(handle.stop).toHaveBeenCalledTimes(1);
    expect(mirror.stopProved).toBe(true);
  });

  it('tells its watchers what the phone is doing', async () => {
    const { mirror, say } = fake();
    const seen: DeviceState[] = [];
    const stop = mirror.watch((s) => seen.push(s));
    await mirror.open(OPTIONS);
    say({ kind: 'state', state: 'asleep' });
    say({ kind: 'state', state: 'ok' });
    expect(seen).toEqual(['asleep', 'ok']);
    stop();
    say({ kind: 'state', state: 'asleep' });
    expect(seen).toHaveLength(2);
  });

  it('a dark phone keeps its stream, says so, and a press lights it, on a dark screen only', async () => {
    const { mirror, handle, module, say } = fake();
    await mirror.open(OPTIONS);
    await mirror.wake();
    expect(handle.input).not.toHaveBeenCalled();
    say({ kind: 'state', state: 'asleep' });
    await expect(mirror.check()).resolves.toMatchObject({ ok: false, need: 'asleep' });
    await mirror.wake();
    expect(handle.input).toHaveBeenCalledWith({ kind: 'button', name: 'home' });
    say({ kind: 'state', state: 'ok' });
    await expect(mirror.check()).resolves.toMatchObject({ ok: true });
    expect(handle.stop).not.toHaveBeenCalled();
    expect(module.start).toHaveBeenCalledTimes(1);
  });

  it('a stream lost for a reason waits on it, and then a new one starts', async () => {
    const { mirror, module, say, tick } = fake();
    const seen: DeviceState[] = [];
    mirror.watch((s) => seen.push(s));
    await mirror.open(OPTIONS);
    say({ kind: 'lost', why: 'The device microphone or camera is in use', need: 'camera-or-mic' });
    expect(seen).toEqual(['camera-or-mic']);
    await expect(mirror.check()).resolves.toMatchObject({ ok: false, need: 'camera-or-mic' });
    tick(3_001);
    await expect(mirror.check()).resolves.toMatchObject({ ok: true });
    await mirror.open(OPTIONS);
    expect(module.start).toHaveBeenCalledTimes(2);
  });

  it('hears nothing more of a stream it has stopped, with a new one in its place', async () => {
    const { mirror, module } = fake();
    const heard: ((e: PhoneStreamEvent) => void)[] = [];
    const handles = [0, 1].map(() => ({
      attach: vi.fn(),
      input: vi.fn(),
      keyframe: vi.fn(),
      stop: vi.fn(() => new Promise<boolean>(() => undefined)),
    }));
    vi.mocked(module.start).mockImplementation((_udid, _options, listener) => {
      heard.push(listener);
      return handles[heard.length - 1]!;
    });
    const seen: DeviceState[] = [];
    mirror.watch((s) => seen.push(s));
    await mirror.open(OPTIONS);
    void mirror.close();
    await mirror.open(OPTIONS);
    heard[0]!({ kind: 'state', state: 'asleep' });
    heard[0]!({ kind: 'lost', why: 'gone', need: 'camera-or-mic' });
    heard[0]!({ kind: 'ended', proved: false });
    await mirror.keyframe();
    expect(handles[1]!.keyframe).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
    await expect(mirror.check()).resolves.toMatchObject({ ok: true });
    await mirror.open(OPTIONS);
    expect(module.start).toHaveBeenCalledTimes(2);
  });

  it('a stream stopped on a dark screen leaves no dark screen behind', async () => {
    const { mirror, say } = fake();
    await mirror.open(OPTIONS);
    say({ kind: 'state', state: 'asleep' });
    await mirror.close();
    await expect(mirror.check()).resolves.toMatchObject({ ok: true });
  });

  it('a stream lost with no reason reads as a phone gone', async () => {
    const { mirror, say } = fake();
    const seen: DeviceState[] = [];
    mirror.watch((s) => seen.push(s));
    await mirror.open(OPTIONS);
    say({ kind: 'lost', why: 'the tunnel ended' });
    expect(seen).toEqual(['not-connected']);
  });
});
