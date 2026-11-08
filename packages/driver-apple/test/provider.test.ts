import { describe, expect, it } from 'vitest';
import { iphoneProvider } from '../src/phone-provider.js';
import { simulatorProvider } from '../src/provider.js';
import { newestRuntimeOf } from '../src/simctl.js';

const udid = '75505767-61E2-40F2-8FC6-8AFE20EE25C9';
const phone = '00001234-0123456789ABCDEF';

describe('the simulator provider', () => {
  it('lists booted simulators, and has nothing that blocks one', async () => {
    const p = simulatorProvider(() =>
      Promise.resolve([{ udid, name: 'appdyno-iphone', state: 'Booted', runtime: 'iOS-27-0' }]),
    );
    expect(await p.list()).toEqual([
      { serial: udid, state: 'booted', ready: true, model: 'iOS simulator appdyno-iphone' },
    ]);
    expect(p).not.toHaveProperty('need');
  });

  it("takes simulator ids, and none of an iPhone's or adb's, as the iPhone provider takes none of its", () => {
    const simulators = simulatorProvider(() => Promise.resolve([]));
    const phones = iphoneProvider({ phones: () => Promise.resolve([]) });
    const serials = [udid, phone, 'a'.repeat(40), 'emulator-5554', 'EXAMPLE0SERIAL00'];
    expect(serials.filter((s) => simulators.handles(s))).toEqual([udid]);
    expect(serials.filter((s) => phones.handles(s))).toEqual([phone, 'a'.repeat(40)]);
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
