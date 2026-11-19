import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodePng, encodePng, must } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { Simctl } from '../src/simctl.js';
import { HelperProcess } from '../src/simhelper.js';
import { onSurface, SimulatorMirror, turnsOf } from '../src/mirror-sim.js';
import { hidKey, HID_MODIFIERS, usageOf } from '../src/simtouch.js';

const UDID = '11111111-2222-3333-4444-555555555555';

function setup(state = 'Booted', exec?: (args: string[]) => Promise<string>) {
  const calls: Record<string, unknown>[] = [];
  const helper = {
    closed: false,
    call: vi.fn((q: Record<string, unknown>) => {
      calls.push(q);
      return Promise.resolve({ ok: true });
    }),
    close: vi.fn(function (this: { closed: boolean }) {
      this.closed = true;
    }),
  };
  const start = vi.fn(() => Promise.resolve(helper as unknown as HelperProcess));
  const paste = vi.fn(() => Promise.resolve(undefined));
  const reader = {
    closed: false,
    orientation: 1,
    answer: true,
    call: vi.fn(function (this: { orientation: number; answer: boolean }) {
      return Promise.resolve({ ok: this.answer, orientation: this.orientation });
    }),
    close: vi.fn(function (this: { closed: boolean }) {
      this.closed = true;
    }),
  };
  const startReader = vi.fn(() => Promise.resolve(reader as unknown as HelperProcess));
  const mirror = new SimulatorMirror(
    UDID,
    { state: () => Promise.resolve(state), exec } as unknown as Simctl,
    start,
    paste,
    startReader,
  );
  return { mirror, calls, helper, start, paste, reader, startReader };
}

describe('a simulator mirror', () => {
  it('says it is off, and offers the surface when booted', async () => {
    await expect(setup('Shutdown').mirror.check()).resolves.toEqual({
      ok: false,
      need: 'simulator-off',
    });
    await expect(setup().mirror.check()).resolves.toMatchObject({ ok: true });
    await expect(setup().mirror.open()).resolves.toMatchObject({ kind: 'surface', udid: UDID });
  });

  it("refuses with the reason of a helper that ended, which this Mac's does as it starts", async () => {
    const why = 'Failed to find service com.apple.coredevice.feature.remote.hid.digitizer';
    const start = () =>
      Promise.resolve(new HelperProcess('sh', ['-c', `echo "${why}" >&2; exit 3`]));
    const mirror = new SimulatorMirror(UDID, {} as Simctl, start, vi.fn(), vi.fn());
    for (const name of ['siri', 'appSwitch'])
      await expect(mirror.input({ kind: 'button', name })).rejects.toMatchObject({
        code: 'UNSUPPORTED',
        message: `the simulator's input helper ended: ${why}`,
      });
  });

  it('readies the helper with the stream, and sends a touch with no wait for proof', async () => {
    const { mirror, calls, start } = setup();
    await mirror.open();
    await mirror.input({ kind: 'touch', p: 0, x: 0.25, y: 0.5 });
    expect(start).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      { op: 'ping' },
      {
        op: 'touch',
        quick: true,
        events: [{ kind: 'touch', p: 0, x: 0.25, y: 0.5, at: 0 }],
      },
    ]);
  });

  it('starts one helper for many touches, and a new one after it ended', async () => {
    const { mirror, helper, start } = setup();
    await mirror.input({ kind: 'touch', p: 0, x: 0, y: 0 });
    await mirror.input({ kind: 'touch', p: 2, x: 0, y: 0 });
    expect(start).toHaveBeenCalledTimes(1);
    helper.closed = true;
    await mirror.input({ kind: 'touch', p: 0, x: 0, y: 0 });
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('a helper that refuses is a failed input, which the session counts', async () => {
    const { mirror, helper } = setup();
    helper.call.mockResolvedValueOnce({ ok: true });
    helper.call.mockResolvedValueOnce({ ok: false, error: 'dtuhidd did not answer' } as never);
    await expect(mirror.input({ kind: 'touch', p: 0, x: 0, y: 0 })).rejects.toThrow(/dtuhidd/);
  });

  it('types a US keyboard as keys, with shift where it needs it', async () => {
    const { mirror, calls } = setup();
    await mirror.input({ kind: 'text', s: 'aB' });
    expect(calls.slice(1)).toEqual([
      { op: 'keyState', page: 7, usage: 4, state: 1 },
      { op: 'keyState', page: 7, usage: 4, state: 2 },
      { op: 'keyState', page: 7, usage: 0xe1, state: 1 },
      { op: 'keyState', page: 7, usage: 5, state: 1 },
      { op: 'keyState', page: 7, usage: 5, state: 2 },
      { op: 'keyState', page: 7, usage: 0xe1, state: 2 },
    ]);
  });

  it('reaches a simulator pasteboard by the one way that checks its id', async () => {
    const pbcopy = vi.fn(() => Promise.resolve(undefined));
    const start = vi.fn(() => Promise.resolve(setup().helper as unknown as HelperProcess));
    const mirror = new SimulatorMirror(UDID, { pbcopy } as unknown as Simctl, start);
    await mirror.input({ kind: 'text', s: 'ş' });
    expect(pbcopy).toHaveBeenCalledWith(UDID, 'ş');
    await expect(new Simctl().pbcopy('x; rm', 'ş')).rejects.toThrow('not a simulator id');
  });

  it('types anything else by the pasteboard and command V', async () => {
    const { mirror, calls, paste } = setup();
    await mirror.input({ kind: 'text', s: 'şğ' });
    expect(paste).toHaveBeenCalledWith(UDID, 'şğ');
    expect(calls[1]).toEqual({ op: 'keyState', page: 7, usage: 0xe3, state: 1 });
    expect(calls[2]).toEqual({ op: 'keyState', page: 7, usage: 0x19, state: 1 });
  });

  it('tells the window why a paste was refused, and presses no command V', async () => {
    const { mirror, calls, paste } = setup();
    const told: Record<string, unknown>[] = [];
    await mirror.open(undefined, undefined, (m) => told.push(m));
    const why = "Simulator's pasteboard sync would put this text on your Mac's clipboard";
    paste.mockRejectedValueOnce(new DeviceError('UNSUPPORTED', why));
    await expect(mirror.input({ kind: 'text', s: 'ş' })).rejects.toThrow(why);
    expect(told).toContainEqual({ op: 'note', text: why });
    expect(calls.filter((c) => c.op === 'keyState')).toEqual([]);
    await mirror.close();
  });

  it('passes a key as it came, up or down; a button by its name', async () => {
    const { mirror, calls } = setup();
    await mirror.input({ kind: 'key', page: 7, usage: 0x28, state: 1 });
    await mirror.input({ kind: 'button', name: 'home' });
    await mirror.input({ kind: 'button', name: 'no-such-button' });
    expect(calls.slice(1)).toEqual([
      { op: 'keyState', page: 7, usage: 0x28, state: 1 },
      { op: 'key', page: 12, usage: 0x40 },
    ]);
  });

  it('closes what it started; twice is once', async () => {
    const { mirror, helper } = setup();
    await mirror.close();
    await mirror.input({ kind: 'touch', p: 0, x: 0, y: 0 });
    await mirror.close();
    await mirror.close();
    expect(helper.close).toHaveBeenCalledTimes(1);
  });
});

describe('a simulator that turns', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());
  const check = () => vi.advanceTimersByTimeAsync(250);

  it('says to stand the picture up on a change only, and a next start begins turned', async () => {
    const { mirror, reader, startReader } = setup();
    const told: Record<string, unknown>[] = [];
    await expect(mirror.open(undefined, undefined, (m) => told.push(m))).resolves.toMatchObject({
      turns: 0,
    });
    await check();
    expect(told).toEqual([]);
    reader.orientation = 3;
    await check();
    await check();
    expect(told).toEqual([{ op: 'turns', turns: 1 }]);
    reader.orientation = 0;
    await check();
    expect(told).toHaveLength(1);
    await expect(mirror.open(undefined, undefined, (m) => told.push(m))).resolves.toMatchObject({
      turns: 1,
    });
    expect(startReader).toHaveBeenCalledTimes(1);
    await mirror.close();
    const asked = reader.call.mock.calls.length;
    await check();
    expect(reader.call.mock.calls.length).toBe(asked);
    expect(reader.close).toHaveBeenCalledTimes(1);
    await mirror.close();
  });

  it('a touch on the stood-up picture lands where the surface has that point', async () => {
    const { mirror, calls, reader } = setup();
    await mirror.open();
    reader.orientation = 3;
    await check();
    await mirror.input({ kind: 'touch', p: 0, x: 0.25, y: 0.5, x2: 1, y2: 0 });
    expect(calls.at(-1)).toMatchObject({
      events: [{ p: 0, x: 0.5, y: 0.25, x2: 1, y2: 1, at: 0 }],
    });
  });

  it('leaves a failed read helper alone for a while, keeps what it knew, and starts it again', async () => {
    const { mirror, reader, startReader } = setup();
    const told: Record<string, unknown>[] = [];
    await mirror.open(undefined, undefined, (m) => told.push(m));
    reader.orientation = 4;
    await check();
    expect(told).toEqual([{ op: 'turns', turns: 3 }]);
    reader.answer = false;
    reader.closed = true;
    reader.orientation = 0;
    await check();
    expect(startReader).toHaveBeenCalledTimes(2);
    await check();
    await check();
    expect(startReader).toHaveBeenCalledTimes(2);
    expect(told).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(startReader).toHaveBeenCalledTimes(3);
    await mirror.close();
  });

  it('a read helper that will not start costs nothing but the turn', async () => {
    const { mirror, startReader } = setup();
    startReader.mockRejectedValueOnce(new Error('no compiler'));
    await expect(mirror.open()).resolves.toMatchObject({ turns: 0 });
    await check();
    await check();
    expect(startReader).toHaveBeenCalledTimes(1);
    await mirror.close();
  });

  it('knows its orientations, and nothing else', () => {
    expect([1, 2, 3, 4].map(turnsOf)).toEqual([0, 2, 1, 3]);
    expect(turnsOf(0)).toBeUndefined();
    expect(turnsOf(5)).toBeUndefined();
  });

  it('goes from a stood-up point to the surface, and a quarter turn takes the corners round', () => {
    expect(onSurface(0.25, 0.75, 0)).toEqual({ x: 0.25, y: 0.75 });
    expect(onSurface(0, 0, 1)).toEqual({ x: 1, y: 0 });
    expect(onSurface(1, 0, 1)).toEqual({ x: 1, y: 1 });
    expect(onSurface(0, 0, 2)).toEqual({ x: 1, y: 1 });
    expect(onSurface(0, 0, 3)).toEqual({ x: 0, y: 1 });
    expect(onSurface(1, 0, 3)).toEqual({ x: 0, y: 0 });
  });
});

describe("a simulator's picture", () => {
  /** The surface as simctl gives it, two pixels across: red at the left, blue at the right. */
  const surface = encodePng({
    width: 2,
    height: 1,
    channels: 3,
    data: Uint8Array.from([255, 0, 0, 0, 0, 255]),
  });
  /** Its pixels top to bottom, left to right, by their colour. */
  const pixels = (png: Buffer) => {
    const image = must(decodePng(png), 'a picture');
    const at = Array.from({ length: image.width * image.height }, (_, i) =>
      image.data[i * image.channels] ? 'red' : 'blue',
    );
    return { w: image.width, h: image.height, at };
  };

  it('stands up as the app in front does, as the surface it is taken from does not turn', async () => {
    const exec = vi.fn((args: string[]) => {
      writeFileSync(must(args.at(-1), 'a file'), surface);
      return Promise.resolve('');
    });
    const { mirror, reader } = setup('Booted', exec);
    const shot = async () => pixels(must(await mirror.screenshot('png'), 'a picture').data);
    expect(await shot()).toEqual({ w: 2, h: 1, at: ['red', 'blue'] });
    // turned right, as a quarter turn to the left stands it up: its right edge goes to the top
    reader.orientation = 3;
    expect(await shot()).toEqual({ w: 1, h: 2, at: ['blue', 'red'] });
    reader.orientation = 4;
    expect(await shot()).toEqual({ w: 1, h: 2, at: ['red', 'blue'] });
    reader.orientation = 2;
    expect(await shot()).toEqual({ w: 2, h: 1, at: ['blue', 'red'] });
    // what will not say how it stands leaves the picture as it is
    reader.answer = false;
    expect(await shot()).toEqual({ w: 2, h: 1, at: ['red', 'blue'] });
    await mirror.close();
  });

  it('pictures and touches the display a foldable shows: simctl asks which, and it comes as it stands', async () => {
    const asked: string[][] = [];
    const exec = vi.fn((args: string[]) => {
      asked.push(args);
      if (!args.some((a) => a.startsWith('--display=')))
        return Promise.reject(new Error('--display=1 LCD (primary) 1398x2034 Invalid argument'));
      writeFileSync(must(args.at(-1), 'a file'), surface);
      return Promise.resolve('');
    });
    const calls: Record<string, unknown>[] = [];
    const hid = {
      closed: false,
      call: (q: Record<string, unknown>) => (calls.push(q), Promise.resolve({ ok: true })),
      close: vi.fn(),
    };
    // open: the app in front lies on its side, and the system frame is not the cover's
    const reader = {
      closed: false,
      call: () =>
        Promise.resolve({ ok: true, orientation: 4, screen: [155.33, 226], main: [466, 678] }),
      close: vi.fn(),
    };
    const display = (id: number, active: boolean) => ({
      id,
      active,
      main: id === 1,
      w: 466,
      h: 678,
      px: '1398x2034',
      scale: 3,
    });
    const mirror = new SimulatorMirror(
      UDID,
      { exec } as unknown as Simctl,
      () => Promise.resolve(hid as unknown as HelperProcess),
      vi.fn(),
      () => Promise.resolve(reader as unknown as HelperProcess),
      () => Promise.resolve([display(1, false), display(3, true)]),
    );
    const shot = pixels(must(await mirror.screenshot('png'), 'a picture').data);
    // not turned again, as the app's orientation would have it
    expect(shot).toEqual({ w: 2, h: 1, at: ['red', 'blue'] });
    expect(asked.map((a) => a.filter((w) => w.startsWith('--display=')))).toEqual([
      [],
      ['--display=3'],
    ]);
    const told: unknown[] = [];
    await mirror.open(undefined, undefined, (m) => told.push(m));
    // with the display's own size: a window opened on a still screen has no frame to find it by
    await vi.waitFor(() => expect(told).toEqual([{ op: 'turns', turns: 3, w: 1398, h: 2034 }]), {
      timeout: 3_000,
    });
    await mirror.input({ kind: 'touch', p: 0, x: 40 / 951, y: 129 / 669 });
    const touch = must(
      calls.find((q) => q.op === 'touch'),
      'a touch',
    ) as { target?: number; events: { x: number; y: number }[] };
    expect(touch.target).toBe(3);
    expect(touch.events[0]?.x).toBeCloseTo(0.193, 3);
    expect(touch.events[0]?.y).toBeCloseTo(0.958, 3);
    await mirror.close();
  });
});

describe('a US keyboard', () => {
  it('knows its characters, and only those', () => {
    expect(usageOf('z')).toEqual({ usage: 0x1d, shift: false });
    expect(usageOf('Z')).toEqual({ usage: 0x1d, shift: true });
    expect(usageOf('1')).toEqual({ usage: 0x1e, shift: false });
    expect(usageOf('!')).toEqual({ usage: 0x1e, shift: true });
    expect(usageOf('0')).toEqual({ usage: 0x27, shift: false });
    expect(usageOf(')')).toEqual({ usage: 0x27, shift: true });
    expect(usageOf('/')).toEqual({ usage: 0x38, shift: false });
    expect(usageOf('?')).toEqual({ usage: 0x38, shift: true });
    expect(usageOf('ş')).toBeUndefined();
  });

  it('presses a letter, a digit or a named key, and holds what a shortcut holds', () => {
    expect(hidKey('a')).toEqual({ page: 7, usage: 0x04 });
    expect(hidKey('0')).toEqual({ page: 7, usage: 0x27 });
    expect(hidKey('arrowUp')).toEqual({ page: 7, usage: 0x52 });
    expect(hidKey('back')).toBeUndefined();
    expect(HID_MODIFIERS.command).toBe(0xe3);
  });
});
