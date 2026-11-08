import { describe, expect, it, vi } from 'vitest';
import { IosPhoneDevice } from '../src/index.js';
import { IosPhonePerf } from '../src/phone-perf.js';

const HOME = 'com.apple.springboard';

/** A phone's runner: it says the home screen of every app but the one it is told of, and only if that is in front. */
function phone(inFront: string, ids = ['dev.one', 'dev.two', 'dev.three']) {
  const device = Object.create(IosPhoneDevice.prototype) as IosPhoneDevice & {
    target(bundle: string): Promise<void>;
  };
  let told: string | undefined;
  const target = vi.fn((bundle: string) => {
    told = bundle;
    return Promise.resolve();
  });
  const listApps = vi.fn(() => Promise.resolve(ids.map((id) => ({ id }))));
  Object.assign(device, {
    target,
    foreground: () => Promise.resolve(told === inFront ? inFront : HOME),
    apps: { listApps },
  });
  return { device, target, listApps };
}

describe('a CPU reading of an app a phone may have stopped', () => {
  const APP = 'dev.app';
  const reading = (foreground: () => Promise<string | undefined>, agentUp = true) => {
    const target = vi.fn(() => Promise.resolve(undefined));
    const perf = new IosPhonePerf({ agentUp, target, foreground } as never);
    const read = { value: { footprintBytes: 1, cpuPercent: 0, windowMs: 1_200 }, raw: 'a trace' };
    const held = perf as unknown as { activity(): Promise<unknown> };
    vi.spyOn(held, 'activity').mockResolvedValue(read);
    return { cpu: () => perf.cpu(APP), target };
  };

  it('says what stood in front, asked of this app, as a runner tells of the one it was told of', async () => {
    const { cpu, target } = reading(() => Promise.resolve(HOME));
    expect((await cpu()).value).toEqual({ percent: 0, windowMs: 1_200, behind: HOME });
    expect(target).toHaveBeenCalledWith(APP);
  });

  it('says nothing of an app in front', async () => {
    expect((await reading(() => Promise.resolve(APP)).cpu()).value).toEqual({
      percent: 0,
      windowMs: 1_200,
    });
  });

  it('starts no runner to ask, as it would take longer than the reading', async () => {
    const foreground = vi.fn(() => Promise.resolve(HOME));
    const { cpu, target } = reading(foreground, false);
    expect((await cpu()).value).toEqual({ percent: 0, windowMs: 1_200 });
    expect(target).not.toHaveBeenCalled();
    expect(foreground).not.toHaveBeenCalled();
  });

  it('keeps its reading when the runner cannot say', async () => {
    const { cpu } = reading(() => Promise.reject(new Error('gone')));
    expect((await cpu()).value).toEqual({ percent: 0, windowMs: 1_200 });
  });
});

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
