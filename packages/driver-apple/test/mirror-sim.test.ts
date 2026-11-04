import { describe, expect, it, vi } from 'vitest';
import type { Simctl } from '../src/simctl.js';
import type { HelperProcess } from '../src/simhelper.js';
import { SimulatorMirror, usageOf } from '../src/mirror-sim.js';

const UDID = '11111111-2222-3333-4444-555555555555';

function setup(state = 'Booted') {
  const calls: Record<string, unknown>[] = [];
  const helper = {
    closed: false,
    call: vi.fn(async (q: Record<string, unknown>) => {
      calls.push(q);
      return { ok: true };
    }),
    close: vi.fn(function (this: { closed: boolean }) {
      this.closed = true;
    }),
  };
  const start = vi.fn(async () => helper as unknown as HelperProcess);
  const paste = vi.fn(async () => undefined);
  const mirror = new SimulatorMirror(
    UDID,
    { state: async () => state } as unknown as Simctl,
    start,
    paste,
  );
  return { mirror, calls, helper, start, paste };
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

  it('types anything else by the pasteboard and command V', async () => {
    const { mirror, calls, paste } = setup();
    await mirror.input({ kind: 'text', s: 'şğ' });
    expect(paste).toHaveBeenCalledWith(UDID, 'şğ');
    expect(calls[1]).toEqual({ op: 'keyState', page: 7, usage: 0xe3, state: 1 });
    expect(calls[2]).toEqual({ op: 'keyState', page: 7, usage: 0x19, state: 1 });
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
});
