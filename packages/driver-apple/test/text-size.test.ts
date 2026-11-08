import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import type { Devicectl } from '../src/devicectl.js';
import { PhoneSettings } from '../src/phone-manage.js';
import type { Simctl } from '../src/simctl.js';
import { SimulatorSettings } from '../src/simulator-manage.js';

const SIM = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
/** As `simctl help ui` and `devicectl device settings appearance --help` list them. */
const SIZES = [
  'extra-small',
  'small',
  'medium',
  'large',
  'extra-large',
  'extra-extra-large',
  'extra-extra-extra-large',
  'accessibility-medium',
  'accessibility-large',
  'accessibility-extra-large',
  'accessibility-extra-extra-large',
  'accessibility-extra-extra-extra-large',
];

/** A simulator's `ui content_size`, as simctl 27.2 answers it: a size it has not got is "Invalid argument", exit 0. */
const simulator = (size = 'large') => {
  const asked: string[][] = [];
  const simctl = {
    exec: (args: string[]) => {
      asked.push(args);
      const [, , option, value] = args;
      if (option !== 'content_size') return Promise.resolve('');
      if (value === undefined) return Promise.resolve(`${size.replace('-small', '-Small')}\n`);
      if (!SIZES.includes(value)) return Promise.resolve('Invalid argument\n');
      size = value;
      return Promise.resolve(`${value}\n`);
    },
  } as unknown as Simctl;
  return { settings: new SimulatorSettings(simctl, SIM), asked };
};

const refusal = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(DeviceError);
  return e as DeviceError;
};

describe('a text size on iOS', () => {
  it('is one of its sizes, and a scale is refused naming them, with nothing asked of the simulator', async () => {
    for (const value of ['1.3', '2', 'xl', 'Large']) {
      const { settings, asked } = simulator();
      const e = await refusal(settings.set('text_size', value));
      expect([e.code, e.message, e.hint]).toEqual([
        'INVALID_ARGUMENT',
        `text_size on iOS is a size, not ${value}`,
        `one of ${SIZES.join(', ')}`,
      ]);
      expect(asked).toEqual([]);
      expect(await settings.get('text_size')).toBe('large');
    }
  });

  it('is set by its name and read back, extra-Small as simctl writes it too', async () => {
    const { settings } = simulator();
    await settings.set('text_size', 'extra-small');
    expect(await settings.get('text_size')).toBe('extra-small');
    await settings.set('text_size', 'accessibility-extra-extra-extra-large');
    expect(await settings.get('text_size')).toBe('accessibility-extra-extra-extra-large');
  });

  it('is refused with what it reads when a phone does not take it, as its accessibility sizes may not', async () => {
    const asked: string[][] = [];
    const ctl = {
      udid: '00008110-000000000000001E',
      json: (args: string[]) => {
        asked.push(args);
        return Promise.resolve({ result: { textSize: 'Extra Extra Extra Large' } });
      },
    } as unknown as Devicectl;
    const settings = new PhoneSettings(ctl);
    await expect(settings.set('text_size', '1.3')).rejects.toThrow('text_size on iOS is a size');
    expect(asked).toEqual([]);
    const e = await refusal(settings.set('text_size', 'accessibility-large'));
    expect([e.code, e.message]).toEqual([
      'UNSUPPORTED',
      'asked for text_size accessibility-large and it reads extra-extra-extra-large',
    ]);
  });
});
