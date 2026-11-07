import { TRANSITION_MS, type DeviceProvider } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, ServerContext } from '../src/index.js';
import { FakeDevice } from './fake-device.js';
import { linkedClient } from './helpers.js';

/** When each touch reached the device, against the first. */
async function connect(platform: 'ios' | 'android' = 'ios') {
  const device = new FakeDevice();
  Object.defineProperty(device, 'platform', { value: platform });
  const at: number[] = [];
  const act = device.act.bind(device);
  Object.assign(device, {
    act: (...a: Parameters<FakeDevice['act']>) => (at.push(Date.now()), act(...a)),
  });
  const provider: DeviceProvider = {
    list: async () => [{ serial: device.serial, state: 'device', ready: true }],
    handles: () => true,
    open: () => device,
  };
  const client = await linkedClient(new ServerContext(DEFAULT_POLICY, [provider], {}), () => {});
  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args });
  return { call, gap: () => at.at(-1)! - at.at(-2)! };
}

// the home screen's Form button, which opens another screen, and empty space below the buttons
const FORM = { x: 540, y: 350 };
const NOTHING = { x: 540, y: 2_300 };

describe('a touch after one that skipped its settle', () => {
  it('waits out the slide of a screen that touch brought, which no read shows', async () => {
    const { call, gap } = await connect();
    await call('screen');
    await call('tap', { ...FORM, read: 'none' });
    await call('tap', { ...NOTHING, read: 'none' });
    expect(gap()).toBeGreaterThanOrEqual(TRANSITION_MS - 20);
  });

  it("is left to Android's agent, which waits for rest before each action", async () => {
    const { call, gap } = await connect('android');
    await call('screen');
    await call('tap', { ...FORM, read: 'none' });
    await call('tap', { ...NOTHING, read: 'none' });
    expect(gap()).toBeLessThan(TRANSITION_MS / 2);
  });

  it('goes at once where that touch changed nothing, and after a settled one', async () => {
    const { call, gap } = await connect();
    await call('screen');
    await call('tap', { ...NOTHING, read: 'none' });
    await call('tap', { ...NOTHING, read: 'none' });
    expect(gap()).toBeLessThan(TRANSITION_MS / 2);
    await call('tap', FORM);
    await call('tap', NOTHING);
    expect(gap()).toBeLessThan(TRANSITION_MS / 2);
  });
});
