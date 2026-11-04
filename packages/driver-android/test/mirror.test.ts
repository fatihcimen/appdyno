import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { Adb } from '../src/adb.js';
import type { AndroidAgentLauncher } from '../src/agent.js';
import { AndroidMirror } from '../src/mirror.js';

const SERIAL = 'phone-1';

function setup(
  o: { state?: string | undefined; sdk?: number; on?: boolean; connect?: Error } = {},
) {
  const calls: [string, unknown][] = [];
  const status = {
    active: 0,
    on: o.on ?? true,
    w: 720,
    h: 1600,
    rotation: 0,
    modes: [],
    dropped: 0,
  };
  const rpc = {
    closed: false,
    call: vi.fn(async (method: string, params: unknown) => {
      calls.push([method, params]);
      return { result: method === 'stream.status' ? status : {} };
    }),
    close: vi.fn(function (this: { closed: boolean }) {
      this.closed = true;
    }),
  };
  const adb = {
    port: 5037,
    devices: async () =>
      'state' in o && o.state === undefined
        ? []
        : [{ serial: SERIAL, state: o.state ?? 'device', props: {} }],
    exec: async () => String(o.sdk ?? 34),
  } as unknown as Adb;
  const launcher = {
    connect: vi.fn(async () => {
      if (o.connect) throw o.connect;
      return { rpc, hello: {}, started: false };
    }),
    address: async () => ({ socket: 'appdyno_x', token: 'the-token' }),
  } as unknown as AndroidAgentLauncher;
  return { mirror: new AndroidMirror(adb, SERIAL, launcher), rpc, calls, status, launcher };
}

describe('an Android mirror', () => {
  it('says what stands in the way, in the words of the table', async () => {
    await expect(setup({ state: undefined }).mirror.check()).resolves.toMatchObject({
      need: 'not-connected',
    });
    await expect(setup({ state: 'offline' }).mirror.check()).resolves.toMatchObject({
      need: 'not-connected',
    });
    await expect(setup({ state: 'unauthorized' }).mirror.check()).resolves.toMatchObject({
      need: 'not-trusted',
    });
    await expect(setup({ sdk: 28 }).mirror.check()).resolves.toMatchObject({ need: 'os-too-old' });
    await expect(setup({ on: false }).mirror.check()).resolves.toMatchObject({ need: 'asleep' });
    await expect(setup().mirror.check()).resolves.toEqual({ ok: true, routes: ['agent'] });
  });

  it('another tool on the device stops it, rather than wait', async () => {
    const { mirror } = setup({ connect: new DeviceError('AGENT_CONFLICT', 'held') });
    await expect(mirror.check()).rejects.toMatchObject({ fatal: true, message: 'held' });
    const gone = setup({ connect: new DeviceError('DEVICE_GONE', 'gone') });
    await expect(gone.mirror.check()).rejects.not.toHaveProperty('fatal');
  });

  it('gives the viewer the address and token, and what to ask for', async () => {
    const { mirror } = setup();
    await expect(mirror.open({ quality: 'high', codec: 'hevc' })).resolves.toEqual({
      kind: 'adb',
      serial: SERIAL,
      socket: 'appdyno_x',
      token: 'the-token',
      codec: 'hevc',
      start: { quality: 'high' },
    });
    await expect(mirror.open({ quality: 'auto' })).resolves.toMatchObject({ codec: 'h264' });
  });

  it('a touch goes as it came, in fractions, on its own connection', async () => {
    const { mirror, calls, launcher } = setup();
    await mirror.input({ kind: 'touch', p: 0, x: 0.5, y: 0.25 });
    await mirror.input({ kind: 'touch', p: 1, x: 0.5, y: 0.25, x2: 0.1, y2: 0.2 });
    expect(calls).toEqual([
      ['touch', { p: 0, x: 0.5, y: 0.25 }],
      ['touch', { p: 1, x: 0.5, y: 0.25, x2: 0.1, y2: 0.2 }],
    ]);
    expect(launcher.connect).toHaveBeenCalledTimes(1);
  });

  it('keys it has go down once; those it has not are passed over', async () => {
    const { mirror, calls } = setup();
    await mirror.input({ kind: 'key', page: 7, usage: 0x28, state: 1 });
    await mirror.input({ kind: 'key', page: 7, usage: 0x28, state: 2 });
    await mirror.input({ kind: 'key', page: 7, usage: 0x52, state: 1 });
    expect(calls).toEqual([['act', { action: { kind: 'key', key: 'enter' }, read: 'none' }]]);
  });

  it('text and buttons go by the agent paths that exist', async () => {
    const { mirror, calls } = setup();
    await mirror.input({ kind: 'text', s: 'ş' });
    await mirror.input({ kind: 'button', name: 'home' });
    await mirror.input({ kind: 'button', name: 'no-such' });
    expect(calls.map((c) => c[0])).toEqual(['text.set', 'act']);
    expect(calls[0]![1]).toMatchObject({ text: 'ş', focusTimeoutMs: 0 });
  });

  it('asks for a keyframe', async () => {
    const { mirror, calls } = setup();
    await mirror.keyframe();
    expect(calls).toEqual([['stream.sync', {}]]);
  });

  it('close proves the streams gone, then lets go; twice is once', async () => {
    const { mirror, rpc, status } = setup();
    await mirror.keyframe();
    status.active = 1;
    setTimeout(() => (status.active = 0), 120);
    await mirror.close();
    expect(status.active).toBe(0);
    expect(rpc.close).toHaveBeenCalledTimes(1);
    await mirror.close();
    expect(rpc.close).toHaveBeenCalledTimes(1);
  });

  it('an agent gone at close is no failure', async () => {
    const { mirror, rpc } = setup();
    await mirror.keyframe();
    rpc.call.mockRejectedValueOnce(new DeviceError('AGENT_UNAVAILABLE', 'gone'));
    await expect(mirror.close()).resolves.toBeUndefined();
  });

  it('tells when the screen goes off and comes back, once each', async () => {
    vi.useFakeTimers();
    try {
      const { mirror, status } = setup();
      await mirror.keyframe();
      const seen: string[] = [];
      const off = mirror.watch((s) => seen.push(s));
      await vi.advanceTimersByTimeAsync(2_000);
      expect(seen).toEqual([]);
      status.on = false;
      await vi.advanceTimersByTimeAsync(3_000);
      expect(seen).toEqual(['asleep']);
      status.on = true;
      await vi.advanceTimersByTimeAsync(3_000);
      expect(seen).toEqual(['asleep', 'ok']);
      off();
      status.on = false;
      await vi.advanceTimersByTimeAsync(3_000);
      expect(seen).toEqual(['asleep', 'ok']);
    } finally {
      vi.useRealTimers();
    }
  });
});
