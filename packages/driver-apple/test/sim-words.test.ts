import { DeviceError } from '@appdyno/protocol';
import { expect, it } from 'vitest';
import { on } from '../src/manage.js';
import type { Simctl } from '../src/simctl.js';
import { SimulatorApps } from '../src/simulator-manage.js';

it('takes a switch as on or off, true or false, or its own word, and refuses any other', () => {
  expect(on('on', 'dark', 'light')).toBe('dark');
  expect(on('true', 'dark', 'light')).toBe('dark');
  expect(on('false', 'dark', 'light')).toBe('light');
  expect(on('light', 'dark', 'light')).toBe('light');
  expect(() => on('maybe', 'dark', 'light')).toThrow(
    new DeviceError('INVALID_ARGUMENT', 'on or off, not maybe'),
  );
});

it('says which services a simulator takes when simctl refuses one it does not have', async () => {
  const simctl = {
    privacy: () => Promise.reject(new DeviceError('INTERNAL', 'Failed to create TCC record')),
  } as unknown as Simctl;
  const apps = new SimulatorApps(simctl, 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE');
  await expect(apps.permission('dev.app', true, 'kamera')).rejects.toMatchObject({
    code: 'INVALID_ARGUMENT',
    message: expect.stringMatching(
      /^no service kamera on a simulator: all, calendar, .*, siri$/,
    ) as unknown,
  });
  // one it has keeps simctl's own reason
  await expect(apps.permission('dev.app', true, 'photos')).rejects.toMatchObject({
    code: 'INTERNAL',
  });
});
