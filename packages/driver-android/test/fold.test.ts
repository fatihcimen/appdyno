import { must } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { AndroidFold, displayOf, foldStates, poseOf } from '../src/fold.js';

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
  const relaunches: number[] = [];
  const fold = new AndroidFold((c) => {
    asked.push(c);
    if (c === 'cmd device_state print-states') return Promise.resolve(states);
    if (c === 'cmd device_state print-state') return Promise.resolve(`${override?.[0] ?? 3}\n`);
    if (c === 'cmd device_state state reset') override = undefined;
    const id = /state (\d+)$/.exec(c)?.[1];
    if (id === '1') relaunches.push(100 + relaunches.length);
    if (id)
      override = [Number(id), must(['', 'CLOSED', 'HALF_OPENED', 'OPENED'][Number(id)], 'a state')];
    if (c === 'dumpsys device_state')
      return Promise.resolve(
        [
          state('mCommittedState', ...(override ?? [3, 'OPENED'])),
          state('mBaseState', 3, 'OPENED'),
          override ? state('mOverrideState', ...override) : '  mOverrideState=Optional.empty',
        ].join('\n'),
      );
    if (c.startsWith('dumpsys activity'))
      return Promise.resolve(
        '    topResumedActivity=ActivityRecord{685447 u0 dev.appdyno.fixture/.MainActivity t9}\n',
      );
    if (c === 'wm size; wm density')
      return Promise.resolve(
        override?.[0] === 1
          ? 'Physical size: 1080x2424\nPhysical density: 390\n'
          : 'Physical size: 2076x2152\nPhysical density: 390\n',
      );
    // closing swaps the display, and an activity that takes no such change itself is made anew: the line stays in the log
    if (c.startsWith('logcat -b events'))
      return Promise.resolve(
        `--------- beginning of events\n${relaunches.map((ms) => `11-16 09:09:33.${String(ms)}   576   601 I wm_relaunch_resume_activity: [0,6837319,9,dev.appdyno.fixture/.MainActivity,900]\n`).join('')}`,
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
    expect(
      ['FOLDED', 'UNFOLDED', 'REAR_DISPLAY', 'REAR_DISPLAY_MODE', 'REAR_DISPLAY_STATE'].map(poseOf),
    ).toEqual(['closed', 'open', 'rear_display', 'rear_display', 'rear_display']);
    expect(['CONCURRENT_INNER_DEFAULT', 'DUAL_DISPLAY_MODE', 'TENT'].map(poseOf)).toEqual([
      'dual',
      'dual',
      'tent',
    ]);
  });

  it('lists the poses of a Pixel 9 Pro Fold emulator, API 35, as it printed them', async () => {
    const printed = `Supported states: [
  DeviceState{identifier=0, name='CLOSED', app_accessible=true, cancel_when_requester_not_on_top=false},
  DeviceState{identifier=1, name='HALF_OPENED', app_accessible=true, cancel_when_requester_not_on_top=false},
  DeviceState{identifier=2, name='OPENED', app_accessible=true, cancel_when_requester_not_on_top=false},
  DeviceState{identifier=3, name='REAR_DISPLAY_MODE', app_accessible=true, cancel_when_requester_not_on_top=false},
]`;
    expect(await foldable(printed).fold.poses()).toEqual([
      'closed',
      'half_opened',
      'open',
      'rear_display',
    ]);
  });

  it('answers a change with the display apps then see, and whether the activity in front was made anew', async () => {
    const { fold } = foldable();
    expect(await fold.set('closed')).toBe(
      'display 1080x2424 at 390 dpi; dev.appdyno.fixture/.MainActivity was recreated',
    );
    // half open is the same display: by `half` too, as a person may say it
    expect(await fold.set('half')).toBe(
      'display 2076x2152 at 390 dpi; dev.appdyno.fixture/.MainActivity was kept',
    );
    expect(await fold.get()).toBe('half_opened');
    expect(await fold.set('default (now open)')).toBeUndefined();
    expect(
      displayOf('Physical size: 1080x2424\nOverride size: 720x1616\nPhysical density: 390\n'),
    ).toBe('display 720x1616 at 390 dpi');
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
    expect(asked).toContain('cmd device_state state reset');
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
