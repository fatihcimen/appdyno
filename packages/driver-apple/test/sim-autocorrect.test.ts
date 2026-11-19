import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import type { Simctl } from '../src/simctl.js';
import { SimulatorSettings } from '../src/sim-settings.js';

const SIM = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';

/** A simulator's `defaults`, as `simctl spawn` runs it: a key not set is an error to read; `notifyutil` is heard. */
const simulator = (set: Record<string, string> = {}) => {
  const store = new Map(Object.entries(set));
  const told: string[] = [];
  const simctl = {
    exec: (args: string[]) => {
      const [, , tool, verb, domain = '', key = '', , value] = args;
      if (tool === 'notifyutil') told.push(String(args[4]));
      if (tool !== 'defaults') return Promise.resolve('');
      const at = `${domain} ${key}`;
      if (verb === 'read') {
        const v = store.get(at);
        return v === undefined
          ? Promise.reject(new Error('does not exist'))
          : Promise.resolve(`${v}\n`);
      }
      if (verb === 'write') store.set(at, value === 'YES' ? '1' : '0');
      if (verb === 'delete') store.delete(at);
      return Promise.resolve('');
    },
  } as unknown as Simctl;
  return { settings: new SimulatorSettings(simctl, SIM), store, told };
};

describe("a simulator keyboard's corrections", () => {
  it('read as the default where none is set, go off each and tell the keyboard, and go back to the default', async () => {
    const { settings, store, told } = simulator();
    expect(await settings.get('autocorrect')).toBe('default');
    await settings.set('autocorrect', 'off');
    expect([...store.keys()].sort()).toEqual([
      'com.apple.keyboard.predictive KeyboardPrediction',
      'com.apple.keyboard.preferences HWKeyboardAutocorrection',
      'com.apple.keyboard.preferences HWKeyboardPeriodShortcut',
      'com.apple.keyboard.preferences KeyboardAutocorrection',
      'com.apple.keyboard.preferences KeyboardPeriodShortcut',
      'com.apple.keyboard.preferences SmartTyping',
    ]);
    expect([...store.values()].every((v) => v === '0')).toBe(true);
    expect(told).toEqual([
      'AppleKeyboardsPreferencesChangedNotification',
      'AppleKeyboardsPredictiveChangedNotification',
    ]);
    expect(await settings.get('autocorrect')).toBe('off');
    await settings.set('autocorrect', 'default');
    expect(store.size).toBe(0);
  });

  it('puts back what a person set by hand as it was, and leaves unset what they never set', async () => {
    const own = {
      'com.apple.keyboard.preferences KeyboardAutocorrection': '1',
      'com.apple.keyboard.preferences SmartTyping': '0',
    };
    const { settings, store } = simulator(own);
    const was = await settings.get('autocorrect');
    expect(was).toBe(
      'KeyboardAutocorrection=1 HWKeyboardAutocorrection=- KeyboardPrediction=- KeyboardPeriodShortcut=- HWKeyboardPeriodShortcut=- SmartTyping=0',
    );
    await settings.set('autocorrect', 'off');
    await settings.set('autocorrect', was);
    expect(Object.fromEntries(store)).toEqual(own);
    expect(await settings.get('autocorrect')).toBe(was);
  });

  it('refuses a value of another shape, and writes nothing', async () => {
    const { settings, store } = simulator();
    const e = await settings.set('autocorrect', 'on').then(
      () => undefined,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(DeviceError);
    expect((e as DeviceError).code).toBe('INVALID_ARGUMENT');
    expect(store.size).toBe(0);
  });
});
