import { must } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { AndroidFold, foldStates, poseOf } from '../src/fold.js';

/** What `cmd device_state print-states` answered on a 7.6" foldable emulator, API 34. */
const STATES = `Supported states: [
  DeviceState{identifier=1, name='CLOSED', app_accessible=true, cancel_when_requester_not_on_top=false},
  DeviceState{identifier=2, name='HALF_OPENED', app_accessible=true, cancel_when_requester_not_on_top=false},
  DeviceState{identifier=3, name='OPENED', app_accessible=true, cancel_when_requester_not_on_top=false},
]`;
const state = (key: string, id: number, name: string) =>
  `  ${key}=Optional[DeviceState{identifier=${id}, name='${name}', app_accessible=true}]`;

/** A foldable whose request is `override`, if any, and what it was asked. */
const foldable = (states = STATES) => {
  const asked: string[] = [];
  let override: [number, string] | undefined;
  const fold = new AndroidFold((c) => {
    asked.push(c);
    if (c === 'cmd device_state print-states') return Promise.resolve(states);
    if (c === 'cmd device_state print-state') return Promise.resolve(`${override?.[0] ?? 3}\n`);
    if (c === 'cmd device_state state reset') override = undefined;
    const id = /state (\d+)$/.exec(c)?.[1];
    if (id)
      override = [Number(id), must(['', 'CLOSED', 'HALF_OPENED', 'OPENED'][Number(id)], 'a state')];
    if (c === 'dumpsys device_state')
      return Promise.resolve(
        [
          state('mCommittedState', ...(override ?? [3, 'OPENED'])),
          override ? state('mOverrideState', ...override) : '  mOverrideState=Optional.empty',
        ].join('\n'),
      );
    return Promise.resolve('');
  });
  return { fold, asked };
};

describe('a fold', () => {
  it('reads its states by their names, whatever their ids', () => {
    expect(foldStates(STATES)).toEqual([
      { id: 1, pose: 'closed' },
      { id: 2, pose: 'half_opened' },
      { id: 3, pose: 'open' },
    ]);
    expect([poseOf('FOLDED'), poseOf('UNFOLDED'), poseOf('REAR_DISPLAY')]).toEqual([
      'closed',
      'open',
      'rear_display',
    ]);
  });

  it('is asked for by its id, read back, and put back by a reset', async () => {
    const { fold, asked } = foldable();
    expect(await fold.get()).toBe('default (now open)');
    await fold.set('closed');
    expect(asked).toContain('cmd device_state state 1');
    expect(await fold.get()).toBe('closed');
    await fold.set('half_opened');
    expect(await fold.get()).toBe('half_opened');
    await fold.set('default (now open)');
    expect(asked.at(-1)).toBe('cmd device_state state reset');
    expect(await fold.get()).toBe('default (now open)');
  });

  it('refuses a pose it has not, and a device that does not fold', async () => {
    await expect(foldable().fold.set('flat')).rejects.toThrow(
      'fold: closed, half_opened, open, not flat',
    );
    const phone = foldable(
      "Supported states: [\n  DeviceState{identifier=0, name='DEFAULT', app_accessible=true},\n]",
    );
    await expect(phone.fold.get()).rejects.toThrow(
      'this device does not fold: its states are default',
    );
    await expect(foldable("Can't find service: device_state").fold.set('closed')).rejects.toThrow(
      'this device has no fold states (cmd device_state, API 31+)',
    );
  });
});
