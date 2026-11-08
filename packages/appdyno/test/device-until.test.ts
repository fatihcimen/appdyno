import { describe, expect, it, vi } from 'vitest';

/** A device suite's own, reached by its path as a script is: it is no part of any package. */
const { askOf, devicesOfRun, untilWithin } = (await import(
  new URL('../../../device-tests/until.ts', import.meta.url).href
)) as {
  askOf: (id: string) => { file: string; args: string[]; about: (line: string) => boolean };
  devicesOfRun: (env: Record<string, string | undefined>) => string[];
  untilWithin: (
    within: number,
    stateNow: () => Promise<string>,
  ) => (what: string, test: () => boolean | Promise<boolean>, ms?: number) => Promise<void>;
};

describe('a wait in a device suite', () => {
  it('that runs out names what it waited for, and how the device stood', async () => {
    const until = untilWithin(1, () => Promise.resolve('emulator-5612: mWakefulness=Asleep'));
    await expect(until('a first picture', () => false)).rejects.toThrow(
      'no a first picture in 1 ms; emulator-5612: mWakefulness=Asleep',
    );
  });

  it('asks the device nothing until it has run out', async () => {
    const state = vi.fn(() => Promise.resolve('x'));
    let left = 2;
    await untilWithin(10_000, state)('a turn', () => left-- === 0);
    expect(state).not.toHaveBeenCalled();
  });

  it('takes a test that has to ask the device itself, and a time of its own', async () => {
    const until = untilWithin(10_000, () => Promise.resolve('x'));
    await until('a screen', () => Promise.resolve(true));
    await expect(until('a screen', () => Promise.resolve(false), 1)).rejects.toThrow('in 1 ms');
  });
});

describe('how a device is asked how it stands', () => {
  it('goes by the kind of its id', () => {
    expect(askOf('emulator-5612').file).toBe('adb');
    expect(askOf('emulator-5612').args.slice(0, 2)).toEqual(['-s', 'emulator-5612']);
    expect(askOf('00000000-0000-4000-8000-000000000001').args.slice(0, 2)).toEqual([
      'simctl',
      'list',
    ]);
    expect(askOf('00001234-0123456789ABCDEF').args[0]).toBe('devicectl');
  });

  it('keeps of a list only the line about that device', () => {
    const { about } = askOf('00000000-0000-4000-8000-000000000001');
    expect(about('ui (00000000-0000-4000-8000-000000000001) (Booted)')).toBe(true);
    expect(about('-- iOS 27.2 --')).toBe(false);
  });

  it('finds every device of a run, however it was named, once', () => {
    expect(
      devicesOfRun({
        APPDYNO_ANDROID_SERIAL: 'a',
        APPDYNO_PAIR: 'a,b',
        APPDYNO_HUB_DEVICES: 'c',
        OTHER: 'd',
      }),
    ).toEqual(['a', 'c', 'b']);
    expect(devicesOfRun({})).toEqual([]);
  });
});
