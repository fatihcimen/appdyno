import type { DeviceProvider, Startable, VirtualDevices } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, ServerContext, type Policy } from '../src/index.js';
import { FakeDevice } from './fake-device.js';
import { callerOf } from './helpers.js';

const SIM = '7A2B6C1D-0000-4000-8000-0000000000AA';

/** A booted simulator and a running emulator, each listed by its serial and known by its own name. */
function context(policy: Partial<Policy> = {}) {
  const sim = new FakeDevice(SIM);
  const emu = new FakeDevice('emulator-5554');
  const running: Startable[] = [
    { id: SIM, name: 'bench-sim (27.2)', state: 'running', serial: SIM, model: 'iPhone 17 Pro' },
    { id: 'emulator-5554', name: 'Pixel_8_API_34', state: 'running', serial: 'emulator-5554' },
  ];
  const virtual: VirtualDevices = {
    kind: 'simulator',
    platform: 'ios',
    startable: () => Promise.resolve(running),
    boot: (id) => Promise.resolve(id),
    shutdown: () => Promise.resolve(),
  };
  const provider: DeviceProvider = {
    list: () =>
      Promise.resolve([
        { serial: SIM, state: 'booted', ready: true, model: 'iOS simulator bench-sim' },
        { serial: 'emulator-5554', state: 'device', ready: true, model: 'sdk_gphone64_arm64' },
      ]),
    handles: () => true,
    open: (serial) => (serial === SIM ? sim : emu),
    virtual,
  };
  const ctx = new ServerContext({ ...DEFAULT_POLICY, ...policy }, [provider], {});
  return { ctx, call: callerOf(ctx) };
}

describe('use_device by what a person calls the device', () => {
  it.each([
    ['its simulator name', 'bench-sim', SIM],
    ['its simulator name with its runtime', 'bench-sim (27.2)', SIM],
    ['its model', 'iPhone 17 Pro', SIM],
    ["its AVD's name", 'Pixel_8_API_34', 'emulator-5554'],
    ['its serial', 'emulator-5554', 'emulator-5554'],
  ])('takes %s', async (_, said, serial) => {
    const { ctx, call } = context();
    const r = await call('use_device', { device: said });
    expect(r.data.serial).toBe(serial);
    expect(r.text).toContain(
      said === serial ? `selected ${said}:` : `selected ${said} (${serial}):`,
    );
    expect(ctx.selected).toBe(serial);
  });

  it('lets in a device the allow list names by its udid when it is called by its name, and the other way', async () => {
    const byId = context({ devices: new RegExp(`^${SIM}$`) });
    expect((await byId.call('use_device', { device: 'bench-sim' })).data.serial).toBe(SIM);
    const byName = context({ devices: /^bench-sim$/ });
    expect((await byName.call('use_device', { device: 'bench-sim' })).data.serial).toBe(SIM);
    // and its session after it, which goes by its serial
    expect((await byName.call('device_info')).data.serial).toBe(SIM);
  });

  it('refuses one the allow list leaves out with the devices it may drive, by name', async () => {
    const { call } = context({ devices: /^Pixel_8_API_34$/ });
    await expect(call('use_device', { device: 'bench-sim' })).rejects.toMatchObject({
      code: 'POLICY_DENIED',
      message: `bench-sim (27.2) (${SIM}) is not allowed on this server; this server may drive: Pixel_8_API_34 (emulator-5554)`,
      hint: 'use_device takes one of those',
    });
    await expect(call('use_device', { device: 'nothing-here' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message:
        'no device here is named nothing-here; this server may drive: Pixel_8_API_34 (emulator-5554)',
    });
  });
});
