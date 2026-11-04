import { describe, expect, it } from 'vitest';
import type { ListedPhone } from '../src/devicectl.js';
import { appleProvider, phoneNeed } from '../src/provider.js';

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
      { serial: phone, state: 'usb', ready: true, model: 'iPhone' },
    ]);
  });

  it('takes simulator and phone ids, not adb serials', () => {
    const p = appleProvider({ simulators: async () => [], phones: async () => [] });
    expect([udid, phone, 'a'.repeat(40)].every((s) => p.handles(s))).toBe(true);
    expect(['emulator-5554', 'EXAMPLE0SERIAL00'].some((s) => p.handles(s))).toBe(false);
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
