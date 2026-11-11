import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must, type Startable, type VirtualDevices } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { connect } from './shared.js';

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-driving-')));
});

describe('simulators and emulators', () => {
  class Fleet implements VirtualDevices {
    log: string[] = [];
    all: Startable[] = [
      { id: 'A', name: 'one', state: 'stopped' },
      { id: 'B', name: 'two', state: 'running', serial: 'B' },
    ];
    readonly kind = 'simulator';
    readonly platform = 'ios';
    startable = () => Promise.resolve(this.all);
    boot = (id: string) => {
      this.log.push(`boot ${id}`);
      must(
        this.all.find((d) => d.id === id),
        id,
      ).state = 'running';
      return Promise.resolve(id);
    };
    shutdown = (id: string) => {
      this.log.push(`shutdown ${id}`);
      must(
        this.all.find((d) => d.id === id),
        id,
      ).state = 'stopped';
      return Promise.resolve();
    };
    create = () => {
      this.all.push({ id: 'C', name: 'new', state: 'stopped' });
      return Promise.resolve('C');
    };
  }

  it('selects the one it creates, so that the next call goes to it', async () => {
    const fleet = new Fleet();
    const { call, ctx } = await connect(new FakeDevice(), { virtual: fleet });
    const r = await call('simulator', { action: 'create', name: 'iPhone 17' });
    expect(r.text).toContain('selected as C');
    expect(ctx.selected).toBe('C');
  });

  it('makes none while an allow list names devices, as a new one could not be on it', async () => {
    const fleet = new Fleet();
    const { call } = await connect(new FakeDevice(), {
      virtual: fleet,
      policy: { devices: /^B$/ },
    });
    const r = await call('simulator', { action: 'create', name: 'iPhone 17' });
    expect(r.data.code).toBe('POLICY_DENIED');
    expect(fleet.all.map((d) => d.id)).toEqual(['A', 'B']);
  });

  it('says how a person removes one it made that did not start', async () => {
    class Stuck extends Fleet {
      removedBy = (id: string) => `remove ${id}`;
      boot = () => Promise.reject(new DeviceError('TIMEOUT', 'it did not boot'));
    }
    const { call } = await connect(new FakeDevice(), { virtual: new Stuck() });
    const r = await call('simulator', { action: 'create', name: 'iPhone 17' });
    expect(r.data.code).toBe('TIMEOUT');
    expect(r.data.hint).toBe('it stays on this Mac: remove C removes it');
  });

  it('says what goes with the selected device as it shuts it down, and selects it no more', async () => {
    const fleet = new Fleet();
    const { call, ctx } = await connect(new FakeDevice(), { virtual: fleet });
    await ctx.use('B');
    const r = await call('simulator', { action: 'shutdown', name: 'B' });
    expect(r.text).toBe('shut down two: the session on two ended, and what its apps held with it');
    expect(ctx.selected).toBeUndefined();
    expect((await call('simulator', { action: 'shutdown', name: 'A' })).text).toBe('shut down one');
  });

  it('boots only on request, and shuts down only what it started unless named', async () => {
    const fleet = new Fleet();
    const { call } = await connect(new FakeDevice(), { virtual: fleet });
    expect((await call('simulator', { action: 'list' })).text).toContain('A "one" stopped');
    expect((await call('simulator', { action: 'boot' })).error).toBe(true);
    expect((await call('simulator', { action: 'shutdown' })).text).toContain('none to shut down');
    expect(fleet.log).toEqual([]);
    expect((await call('simulator', { action: 'boot', name: 'one' })).data.serial).toBe('A');
    expect((await call('simulator', { action: 'list' })).text).toContain('started by this tool');
    await call('simulator', { action: 'shutdown' });
    expect(fleet.log).toEqual(['boot A', 'shutdown A']);
    await call('simulator', { action: 'shutdown', name: 'B' });
    expect(fleet.log.at(-1)).toBe('shutdown B');
    expect((await call('simulator', { action: 'boot', name: 'nope' })).data.code).toBe('NOT_FOUND');
  });

  /** One emulator running, listed by its serial; stopped, by its AVD's name alone. */
  class Emulators implements VirtualDevices {
    log: string[] = [];
    all: Startable[] = [
      { id: 'emulator-5682', name: 'Pixel_34', state: 'running', serial: 'emulator-5682' },
    ];
    readonly kind = 'emulator';
    readonly platform = 'android';
    startable = () => Promise.resolve(this.all);
    shutdown = (id: string) => {
      this.log.push(`shutdown ${id}`);
      this.all = this.all.map((d) =>
        d.id === id ? { id: d.name, name: d.name, state: 'stopped' } : d,
      );
      return Promise.resolve();
    };
    boot = (id: string, ranAs?: string) => {
      this.log.push(`boot ${id} as ${ranAs ?? 'any'}`);
      const serial = ranAs ?? 'emulator-5554';
      this.all = this.all.map((d) =>
        d.id === id ? { id: serial, name: d.name, state: 'running', serial } : d,
      );
      return Promise.resolve(serial);
    };
  }

  it('shuts down and boots an emulator allowed by its serial or its name alike, and it comes back as the serial it ran as', async () => {
    for (const devices of [/^emulator-5682$/, /^Pixel_34$/])
      for (const again of ['emulator-5682', 'Pixel_34']) {
        const fleet = new Emulators();
        const { call } = await connect(new FakeDevice(), { virtual: fleet, policy: { devices } });
        expect((await call('simulator', { action: 'shutdown', name: 'emulator-5682' })).error).toBe(
          false,
        );
        const up = await call('simulator', { action: 'boot', name: again });
        expect(up.data.serial, `${String(devices)} ${again}`).toBe('emulator-5682');
        expect(fleet.log).toEqual(['shutdown emulator-5682', 'boot Pixel_34 as emulator-5682']);
      }
  });

  it('refuses a shutdown that boot would refuse, and leaves the device on', async () => {
    const fleet = new Emulators();
    const { call } = await connect(new FakeDevice(), {
      virtual: fleet,
      policy: { devices: /^emulator-5554$/ },
    });
    const denied = await call('simulator', { action: 'shutdown', name: 'emulator-5682' });
    expect(denied.data.code).toBe('POLICY_DENIED');
    expect(denied.data.hint).toContain('emulator-5682, Pixel_34');
    const other = new Emulators();
    other.all = other.all.map((d) => ({ ...d, bootable: false }));
    const lost = await connect(new FakeDevice(), { virtual: other });
    expect(
      (await lost.call('simulator', { action: 'shutdown', name: 'emulator-5682' })).data.code,
    ).toBe('NOT_FOUND');
    expect([...fleet.log, ...other.log]).toEqual([]);
  });
});
