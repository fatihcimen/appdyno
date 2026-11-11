import type { DeviceProvider } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { ServerContext } from '../src/context.js';
import { DEFAULT_POLICY } from '../src/policy.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';

const provider = (list: Awaited<ReturnType<DeviceProvider['list']>>): DeviceProvider => ({
  list: () => Promise.resolve(list),
  handles: () => true,
  open: () => new FakeDevice(),
});

const contextOf = (...providers: DeviceProvider[]) =>
  new ServerContext(DEFAULT_POLICY, providers, {});

describe('a device warmed before its first call', () => {
  it('is the one its session drives, warmed again as it opens, and none this server may not drive', async () => {
    const opened: FakeDevice[] = [];
    let warmed = 0;
    const p = provider([{ serial: 'one', state: 'booted', ready: true }]);
    p.open = () => {
      const d = Object.assign(new FakeDevice(), {
        warm: () => {
          warmed++;
        },
      });
      opened.push(d);
      return d;
    };
    const ctx = new ServerContext({ ...DEFAULT_POLICY, devices: /^one$/ }, [p], {});
    ctx.warm('one');
    ctx.warm('other');
    const s = await ctx.session('one');
    // the session's device is that one behind the guard of its inputs, which reads it as it is
    expect([opened.length, s.device.hello === opened[0]?.hello, warmed]).toEqual([1, true, 2]);
  });
});

describe('the device a call uses with none named', () => {
  it.each([
    ['a lone booted simulator', 'booted'],
    ['a lone iPhone', 'usb'],
    ['a lone Android device', 'device'],
  ])('is %s', async (_, state) => {
    const ctx = contextOf(provider([{ serial: 'one', state, ready: true }]));
    await expect(ctx.session()).resolves.toBeDefined();
  });

  it('is the ready one, when another is only listed', async () => {
    const ctx = contextOf(
      provider([
        { serial: 'locked', state: 'unauthorized', ready: false },
        { serial: 'one', state: 'booted', ready: true },
      ]),
    );
    await expect(ctx.session()).resolves.toBeDefined();
  });

  it('is none when nothing is ready, and the answer says so', async () => {
    const ctx = contextOf(provider([{ serial: 'locked', state: 'offline', ready: false }]));
    await expect(ctx.session()).rejects.toThrow(/no connected device/);
  });

  it('is never a guess between two ready devices, on any driver', async () => {
    const ctx = contextOf(
      provider([{ serial: 'phone', state: 'device', ready: true }]),
      provider([{ serial: 'sim', state: 'booted', ready: true }]),
    );
    await expect(ctx.session()).rejects.toThrow(/more than one device/);
  });

  it('is refused naming each it could be, by serial, kind and model, with how to pick one', async () => {
    const ctx = contextOf(
      provider([
        { serial: 'emulator-5580', state: 'device', ready: true, model: 'sdk_gphone64_arm64' },
        { serial: 'R58M', state: 'device', ready: true },
        { serial: 'locked', state: 'unauthorized', ready: false },
      ]),
      provider([{ serial: 'SIM-1', state: 'booted', ready: true, model: 'iOS simulator a' }]),
    );
    await expect(ctx.session()).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message:
        'more than one device this server may drive: emulator-5580 (emulator, sdk_gphone64_arm64); R58M (phone); SIM-1 (simulator, iOS simulator a)',
      hint: 'pick one with use_device: device "emulator-5580" or device "R58M" or device "SIM-1"',
    });
  });
});
