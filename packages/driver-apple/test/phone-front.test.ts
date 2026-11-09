import { describe, expect, it, vi } from 'vitest';
import { IosPhonePerf } from '../src/phone-perf.js';

const HOME = 'com.apple.springboard';

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
