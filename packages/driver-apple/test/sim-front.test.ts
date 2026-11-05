import { describe, expect, it, vi } from 'vitest';
import { IosSimulatorDevice } from '../src/index.js';
import { Simctl } from '../src/simctl.js';

const UDID = 'C8F701E7-9A02-4465-AC91-F4C85FBA788D';

class Listed extends Simctl {
  constructor(private readonly listing: string) {
    super({});
  }
  override exec = async () => this.listing;
}

const LISTING = [
  'PID\tStatus\tLabel',
  '5352\t0\tcom.apple.SpringBoard',
  '-\t0\tUIKitApplication:dev.app[a971][rb-legacy]',
  '29658\t0\tUIKitApplication:dev.app[b202][rb-legacy]',
].join('\n');

describe('a running app on a simulator', () => {
  it('is found by its label, past a process just ended', async () => {
    expect(await new Listed(LISTING).pid(UDID, 'dev.app')).toBe(29658);
  });

  it('includes the home screen, which is a service with a label of its own', async () => {
    expect(await new Listed(LISTING).pid(UDID, 'com.apple.springboard')).toBe(5352);
  });

  it('says what is not running, by name', async () => {
    await expect(new Listed(LISTING).pid(UDID, 'dev.other')).rejects.toThrow(
      'dev.other is not running',
    );
  });
});

describe('what is in front of a simulator with no runner', () => {
  const withFront = (front: string | undefined) => {
    const read = vi.fn(async () => front);
    const direct = { front: read, close: vi.fn() };
    const device = new IosSimulatorDevice(UDID, new Listed(''), direct as never);
    return device;
  };

  it('is what its read helper says, and needs no runner', async () => {
    expect(await withFront('dev.app').foreground()).toBe('dev.app');
  });

  it('is read with no app named, so that a first look at a simulator starts no runner', async () => {
    const tree = { windows: [], nodes: [], hash: 'h', truncated: false };
    const read = vi.fn(async () => ({ busy: false, copies: false, tree }));
    const direct = { front: async () => 'com.apple.springboard', read, close: vi.fn() };
    const device = Object.assign(new IosSimulatorDevice(UDID, new Listed(''), direct as never), {
      keepDump: async () => undefined,
    });
    await expect(device.tree()).resolves.toMatchObject({ hash: 'h' });
    expect(read).toHaveBeenCalledWith('com.apple.springboard');
  });

  it('is nothing yet when the helper has no answer, and no refusal', async () => {
    await expect(withFront(undefined).foreground()).resolves.toBeUndefined();
  });
});
