import type { DeviceProvider } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { ServerContext } from '../src/context.js';
import { DEFAULT_POLICY } from '../src/policy.js';
import { FakeDevice } from './fake-device.js';

const provider = (list: Awaited<ReturnType<DeviceProvider['list']>>): DeviceProvider => ({
  list: async () => list,
  handles: () => true,
  open: () => new FakeDevice(),
});

const contextOf = (...providers: DeviceProvider[]) =>
  new ServerContext(DEFAULT_POLICY, providers, {});

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
});
