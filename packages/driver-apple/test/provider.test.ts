import { describe, expect, it } from 'vitest';
import { appleProvider } from '../src/provider.js';

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
      { serial: udid, state: 'booted', model: 'iOS simulator appdyno-iphone' },
      { serial: phone, state: 'usb', model: 'iPhone' },
    ]);
  });

  it('takes simulator and phone ids, not adb serials', () => {
    const p = appleProvider({ simulators: async () => [], phones: async () => [] });
    expect([udid, phone, 'a'.repeat(40)].every((s) => p.handles(s))).toBe(true);
    expect(['emulator-5554', 'EXAMPLE0SERIAL00'].some((s) => p.handles(s))).toBe(false);
  });
});
