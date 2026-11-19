import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceProvider, DeviceSettings } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { linkedClient } from '@appdyno/testing/calls.js';
import { DEFAULT_POLICY, ServerContext } from '../../src/index.js';
import { conditions } from '../../src/settings.js';
import type { Result } from './shared.js';

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-replaced-')));
});

const SERIAL = 'emulator-5554';

/** The emulator on the port now: a driver asks the device behind the serial, whichever object asks. */
let onPort: { avd: string } = { avd: '' };

/** An emulator on a port: its AVD, its Android, and its agent's connection, which goes when the emulator ends. */
class Avd extends FakeDevice {
  closed = false;
  readonly values: Record<string, string> = { dark_mode: 'no' };
  override settings: DeviceSettings = {
    get: (name) => Promise.resolve(this.values[name] ?? 'none'),
    set: (name, value) => {
      this.values[name] = value;
      return Promise.resolve(undefined);
    },
  };
  constructor(
    readonly avd: string,
    sdk: number,
  ) {
    super(SERIAL);
    this.hello = { ...this.hello, osVersion: String(sdk - 20), sdk };
  }
  identity = () => Promise.resolve(onPort.avd);
  override async open() {
    const hello = await super.open();
    this.agentUp = true;
    return hello;
  }
  override close = () => {
    this.closed = true;
    return undefined;
  };
}

/** A server whose provider opens whichever emulator answers to the serial now. */
async function serve(first: Avd, allow?: RegExp) {
  let now = first;
  onPort = first;
  const provider: DeviceProvider = {
    list: () =>
      Promise.resolve([{ serial: SERIAL, state: 'device', ready: true, model: 'sdk_gphone64' }]),
    handles: () => true,
    open: () => now,
    virtual: {
      kind: 'emulator',
      platform: 'android',
      startable: () =>
        Promise.resolve([{ id: now.avd, name: now.avd, state: 'running', serial: SERIAL }]),
      boot: () => Promise.resolve(SERIAL),
      shutdown: () => Promise.resolve(),
    },
  };
  const ctx = new ServerContext(
    { ...DEFAULT_POLICY, writeDirs: [tmpdir()], ...(allow && { devices: allow }) },
    [provider],
    { app: 'dev.app' },
  );
  const client = await linkedClient(ctx);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as Result;
    return { error: r.isError === true, text: r.content.map((c) => c.text ?? '').join('\n') };
  };
  /** The emulator ends, and another AVD boots on its port. */
  const swap = (next: Avd) => {
    now.agentUp = false;
    now = next;
    onPort = next;
  };
  return { call, ctx, swap };
}

describe('another device behind a serial', () => {
  it('is opened afresh, its own facts said, and what the last session changed is not put back on it', async () => {
    const api36 = new Avd('emu-36', 36);
    const { call, ctx, swap } = await serve(api36);
    expect((await call('use_device', { device: SERIAL })).text).toContain('Android 16');
    expect((await call('set_device', { name: 'dark_mode', value: 'on' })).error).toBe(false);
    expect(Object.keys(conditions.read(SERIAL) ?? {})).toEqual(['dark_mode']);
    const api34 = new Avd('emu-34', 34);
    swap(api34);
    const r = await call('use_device', { device: SERIAL });
    expect(r.text).toContain('Android 14');
    expect(r.text).not.toContain('Android 16');
    expect(r.text).toContain(
      `${SERIAL} is another device than the one its session opened on: emu-34, where it was emu-36. A session starts afresh on it, and what the last one changed on the device that was there is not put back on this one: dark_mode`,
    );
    expect(api36.closed).toBe(true);
    expect(conditions.read(SERIAL)).toBeUndefined();
    // the session's end puts back nothing on the device that was never changed
    await ctx.end();
    expect(api34.values.dark_mode).toBe('no');
    ctx.close();
  });

  it('is found by any call, not only by use_device, and the same device after a reboot keeps its session', async () => {
    const first = new Avd('emu-36', 36);
    const { call, ctx, swap } = await serve(first);
    await call('read_screen');
    first.agentUp = false;
    expect((await call('read_screen')).text).not.toContain('another device');
    expect(first.closed).toBe(false);
    swap(new Avd('emu-34', 34));
    expect((await call('read_screen')).text).toContain(
      'is another device than the one its session opened on',
    );
    expect(first.closed).toBe(true);
    ctx.close();
  });

  it('is said with the refusal of the first call too, as one that boots fails to start its agent', async () => {
    const { call, ctx, swap } = await serve(new Avd('emu-36', 36));
    await call('read_screen');
    const booting = new Avd('emu-34', 34);
    booting.openError = new DeviceError(
      'INTERNAL',
      'the Android agent could not start: could not open UI automation',
    );
    swap(booting);
    const r = await call('read_screen');
    expect(r.error).toBe(true);
    expect(r.text).toContain('could not open UI automation');
    expect(r.text).toContain(
      `${SERIAL} is another device than the one its session opened on: emu-34, where it was emu-36`,
    );
    ctx.close();
  });

  it('is let in by the allow list again, not by the name of the AVD it took the place of', async () => {
    const { call, ctx, swap } = await serve(new Avd('emu-36', 36), /^emu-36$/);
    expect((await call('use_device', { device: SERIAL })).error).toBe(false);
    swap(new Avd('emu-34', 34));
    const r = await call('read_screen');
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/^POLICY_DENIED: emulator-5554 is not allowed on this server/);
    ctx.close();
  });
});
