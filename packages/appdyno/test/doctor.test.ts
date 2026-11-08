import type { Check, DeviceProvider } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { doctor } from '../src/doctor.js';

/** A driver that notes which serial it was asked about, as the last of two takes what is its own. */
const provider = (name: string, handles: (serial: string) => boolean) => {
  const asked: (string | undefined)[] = [];
  const p: Pick<DeviceProvider, 'handles' | 'doctor'> = {
    handles,
    doctor: (serial): Promise<Check[]> => {
      asked.push(serial);
      return Promise.resolve([{ name, ok: true, detail: serial ?? 'this machine' }]);
    },
  };
  return { asked, provider: p as DeviceProvider };
};

const SIMULATOR = '068C4966-8472-4807-976C-981BBE157DCA';

describe('doctor', () => {
  const drivers = () => ({
    android: provider('android', () => true),
    apple: provider('apple', (s) => s === SIMULATOR),
  });

  it('asks about a device only the driver that would open it', async () => {
    const { android, apple } = drivers();
    await doctor({ providers: [android.provider, apple.provider], serial: SIMULATOR });
    expect(android.asked).toEqual([undefined]);
    expect(apple.asked).toEqual([SIMULATOR]);
  });

  it('leaves a device to the only driver that takes it', async () => {
    const { android, apple } = drivers();
    await doctor({ providers: [android.provider, apple.provider], serial: 'emulator-5554' });
    expect(android.asked).toEqual(['emulator-5554']);
    expect(apple.asked).toEqual([undefined]);
  });

  it('asks about this machine alone with no device named', async () => {
    const { android, apple } = drivers();
    await doctor({ providers: [android.provider, apple.provider] });
    expect(android.asked).toEqual([undefined]);
    expect(apple.asked).toEqual([undefined]);
  });
});
