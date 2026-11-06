import { describe, expect, it } from 'vitest';
import type { ListedPhone } from '../src/devicectl.js';
import { appleProvider, phoneNeed } from '../src/provider.js';
import { newestRuntimeOf } from '../src/simctl.js';

const udid = '75505767-61E2-40F2-8FC6-8AFE20EE25C9';
const phone = '00001234-0123456789ABCDEF';

describe('the Apple provider', () => {
  it('lists booted simulators, then phones', async () => {
    const p = appleProvider({
      simulators: async () => [
        { udid, name: 'appdyno-iphone', state: 'Booted', runtime: 'iOS-27-0' },
      ],
      phones: async () => [phone],
    });
    expect(await p.list()).toEqual([
      { serial: udid, state: 'booted', ready: true, model: 'iOS simulator appdyno-iphone' },
      { serial: phone, state: 'usb', ready: true, model: 'iPhone', link: 'USB' },
    ]);
  });

  it('a phone paired for Wi-Fi stands in the list by the network while it has no cable', async () => {
    const paired = () => [phone];
    const away = appleProvider({ simulators: async () => [], phones: async () => [], paired });
    expect(await away.list()).toEqual([
      { serial: phone, state: 'network', ready: false, model: 'iPhone', link: 'Wi-Fi' },
    ]);
    await expect(away.need!({ serial: phone, state: 'network' })).resolves.toBeUndefined();
    const home = appleProvider({
      simulators: async () => [],
      phones: async () => [phone],
      paired,
    });
    expect(await home.list()).toMatchObject([{ state: 'usb', link: 'USB' }]);
  });

  it('takes simulator and phone ids, not adb serials', () => {
    const p = appleProvider({ simulators: async () => [], phones: async () => [] });
    expect([udid, phone, 'a'.repeat(40)].every((s) => p.handles(s))).toBe(true);
    expect(['emulator-5554', 'EXAMPLE0SERIAL00'].some((s) => p.handles(s))).toBe(false);
  });
});

describe('a model on a runtime', () => {
  const runtime = (version: string, names: string[], isAvailable = true) => ({
    identifier: `iOS-${version}`,
    version,
    platform: 'iOS',
    isAvailable,
    supportedDeviceTypes: names.map((name) => ({ name })),
  });

  it('takes the newest that runs it, as a point release may run few', () => {
    const all = [
      runtime('26.5', ['iPhone 17']),
      runtime('27.2', ['iPhone 17']),
      runtime('27.10', ['iPhone Duo']),
      runtime('28.0', ['iPhone 17'], false),
    ];
    expect(newestRuntimeOf(all, 'iPhone 17')?.version).toBe('27.2');
    expect(newestRuntimeOf(all, 'iPhone Duo')?.version).toBe('27.10');
    expect(newestRuntimeOf(all, 'Nokia 3310')).toBeUndefined();
  });
});

describe('what blocks a phone', () => {
  const need = (listed: ListedPhone | undefined, passcodeRequired = false) =>
    phoneNeed({ listed: async () => listed, lockState: async () => ({ passcodeRequired }) });
  const fine: ListedPhone = {
    connectionProperties: { pairingState: 'paired' },
    deviceProperties: { developerModeStatus: 'enabled', osVersionNumber: '27.2' },
  };

  it('nothing on a paired phone in Developer Mode, unlocked', async () => {
    expect(await need(fine)).toBeUndefined();
  });

  it('says the first thing a person has to do', async () => {
    expect(await need(undefined)).toBe('not-connected');
    expect(
      await need({ ...fine, connectionProperties: { pairingState: 'unsupported' } }, true),
    ).toBe('not-trusted');
    expect(
      await need({ ...fine, deviceProperties: { developerModeStatus: 'disabled' } }, true),
    ).toBe('developer-mode-off');
    expect(
      await need({
        ...fine,
        deviceProperties: { developerModeStatus: 'enabled', osVersionNumber: '16.7.2' },
      }),
    ).toBe('os-too-old');
    expect(await need(fine, true)).toBe('locked');
  });

  it('a simulator has none', async () => {
    const p = appleProvider({ simulators: async () => [], phones: async () => [] });
    expect(await p.need!({ serial: udid, state: 'booted' })).toBeUndefined();
  });
});
