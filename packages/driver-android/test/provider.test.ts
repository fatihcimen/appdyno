import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import type { Adb } from '../src/adb.js';
import { androidProvider } from '../src/provider.js';

const withAdb = (devices: Adb['devices']) => androidProvider({ devices } as Adb);

describe('the devices of a Mac', () => {
  it('none when adb is not installed, so that an iOS setup still lists its own', async () => {
    const list = withAdb(async () => {
      throw new DeviceError('UNSUPPORTED', 'adb could not be started');
    }).list();
    await expect(list).resolves.toEqual([]);
  });

  it('a real failure of adb is still said', async () => {
    const list = withAdb(async () => {
      throw new DeviceError('DEVICE_GONE', 'the adb server went away');
    }).list();
    await expect(list).rejects.toThrow(/went away/);
  });

  it('only a device adb calls `device` can be driven', async () => {
    const devices = await withAdb(async () => [
      { serial: 'a', state: 'device', props: {} },
      { serial: 'b', state: 'unauthorized', props: {} },
    ]).list();
    expect(devices.map((d) => [d.serial, d.ready])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });
});
