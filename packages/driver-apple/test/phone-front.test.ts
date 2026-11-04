import { describe, expect, it, vi } from 'vitest';
import { IosPhoneDevice } from '../src/index.js';

const HOME = 'com.apple.springboard';

/** A phone's runner: it says the home screen of every app but the one it is told of, and only if that is in front. */
function phone(inFront: string, ids = ['dev.one', 'dev.two', 'dev.three']) {
  const device = Object.create(IosPhoneDevice.prototype) as IosPhoneDevice & {
    target(bundle: string): Promise<void>;
  };
  let told: string | undefined;
  const target = vi.fn(async (bundle: string) => void (told = bundle));
  const listApps = vi.fn(async () => ids.map((id) => ({ id })));
  Object.assign(device, {
    target,
    foreground: async () => (told === inFront ? inFront : HOME),
    apps: { listApps },
  });
  return { device, target, listApps };
}

describe('what is in front of an iPhone with no app chosen', () => {
  it("is found among a person's apps", async () => {
    expect(await phone('dev.two').device.frontApp()).toBe('dev.two');
  });

  it('is the home screen when none of them is', async () => {
    expect(await phone(HOME).device.frontApp()).toBe(HOME);
  });

  it('asks for the list once, as a window looks every few seconds', async () => {
    const { device, listApps } = phone(HOME);
    await device.frontApp();
    await device.frontApp();
    expect(listApps).toHaveBeenCalledOnce();
  });

  it('asks nothing more while the app it knows stays in front', async () => {
    const { device, listApps } = phone('dev.two');
    await device.frontApp();
    listApps.mockClear();
    await device.frontApp();
    expect(listApps).not.toHaveBeenCalled();
  });

  it('leaves the app it was told of as it was, when none of them is in front', async () => {
    const { device, target } = phone(HOME);
    Object.assign(device, { targetApp: 'dev.one' });
    await device.frontApp();
    expect(target.mock.calls.at(-1)).toEqual(['dev.one']);
  });
});
