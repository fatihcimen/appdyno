import type { DeviceProvider } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, ServerContext } from '../src/index.js';
import { FakeDevice } from './fake-device.js';
import { linkedClient } from './helpers.js';

type Result = { isError?: boolean; content: { text?: string }[] };

/** A device like an iPhone's, whose system words no read of the app has. */
async function connect(words: string[]) {
  const device = new FakeDevice();
  let looks = 0;
  Object.assign(device, {
    systemWords: async () => {
      looks++;
      return words;
    },
  });
  const provider: DeviceProvider = {
    list: async () => [{ serial: device.serial, state: 'device', ready: true }],
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext(DEFAULT_POLICY, [provider], { app: 'dev.app' });
  const client = await linkedClient(ctx, () => undefined);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as Result;
    return r.content.map((c) => c.text ?? '').join('\n');
  };
  return { call, looks: () => looks };
}

describe('a prompt over the app that no read of it has', () => {
  it('is said by a read and a picture', async () => {
    const { call } = await connect(['Face ID']);
    expect(await call('screen')).toContain('needs a person: Face ID');
    expect(await call('screenshot')).toContain('needs a person: Face ID');
  });

  it('is said by an action that changed nothing, which is all it leaves', async () => {
    const { call } = await connect(['Enter iPhone Passcode']);
    await call('screen');
    expect(await call('tap', { x: 1, y: 1 })).toContain('needs a person: a passcode');
  });

  it('costs an action that changed the screen no look', async () => {
    const { call, looks } = await connect(['Face ID']);
    const home = await call('screen');
    const before = looks();
    const form = /(@[a-z0-9-]+) \w+ "Form"/.exec(home)![1];
    expect(await call('tap', { ref: form })).not.toContain('needs a person');
    expect(looks()).toBe(before);
  });

  it('says nothing of ordinary words', async () => {
    const { call } = await connect(['9:41', 'Silent Mode', 'Wi-Fi']);
    expect(await call('screen')).not.toContain('needs a person');
  });
});
