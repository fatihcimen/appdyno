import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import type { Adb } from '../src/adb.js';
import { androidNeed, androidProvider } from '../src/provider.js';

const withAdb = (devices: Adb['devices']) => androidProvider({ devices } as Adb);

describe('the devices of a Mac', () => {
  it('none when adb is not installed, so that an iOS setup still lists its own', async () => {
    const list = withAdb(() => {
      return Promise.reject(new DeviceError('UNSUPPORTED', 'adb could not be started'));
    }).list();
    await expect(list).resolves.toEqual([]);
  });

  it('a real failure of adb is still said', async () => {
    const list = withAdb(() => {
      return Promise.reject(new DeviceError('DEVICE_GONE', 'the adb server went away'));
    }).list();
    await expect(list).rejects.toThrow(/went away/);
  });

  it('only a device adb calls `device` can be driven', async () => {
    const devices = await withAdb(() =>
      Promise.resolve([
        { serial: 'a', state: 'device', props: {} },
        { serial: 'b', state: 'unauthorized', props: {} },
      ]),
    ).list();
    expect(devices.map((d) => [d.serial, d.ready])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });
});

describe('what blocks a listed device', () => {
  const need = (out: string, state = 'device') =>
    androidNeed({ exec: () => Promise.resolve(out) } as unknown as Adb, { serial: 'a', state });

  it('by adb alone when adb cannot reach it', async () => {
    expect(await need('', 'unauthorized')).toBe('not-trusted');
    expect(await need('', 'offline')).toBe('not-connected');
  });

  it('a lock only behind a credential', async () => {
    expect(await need('34\ndeviceLocked=1\n')).toBe('locked');
    expect(await need('34\ndeviceLocked=0\n')).toBeUndefined();
    // a maker's build that prints no such line blocks nothing
    expect(await need('34\n')).toBeUndefined();
  });

  it('an Android the agent does not run on', async () => {
    expect(await need('25\ndeviceLocked=0\n')).toBe('os-too-old');
  });
});
