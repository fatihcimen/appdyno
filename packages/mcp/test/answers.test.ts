import { must, type DeviceProvider } from '@appdyno/core';
import { DEFAULT_POLICY, ServerContext, text } from '@appdyno/ops';
import { expect, it } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { linkedClient } from '@appdyno/testing/calls.js';
import { structuredOf } from '../src/server.js';

type Result = { content: { text?: string }[]; structuredContent?: Record<string, unknown> };

it('holds the whole text and the summary, and no words of the text twice', () => {
  expect(
    structuredOf({
      blocks: text('tapped @k3f9 "Add"\nscreen unchanged'),
      data: { done: 'tapped @k3f9 "Add"', changed: false },
    }),
  ).toEqual({
    text: 'tapped @k3f9 "Add"\nscreen unchanged',
    changed: false,
  });
  // words the text does not hold stay
  expect(structuredOf({ blocks: text('saved'), data: { done: 'exported' } })).toEqual({
    text: 'saved',
    done: 'exported',
  });
});

it('gives steps and a tap their text once, through a client', async () => {
  const device = new FakeDevice();
  const provider: DeviceProvider = {
    list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
    handles: () => true,
    open: () => device,
  };
  const client = await linkedClient(
    new ServerContext(DEFAULT_POLICY, [provider], { app: 'dev.app' }),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as Result;
  const home = must((await call('screen')).content[0]?.text, 'the screen');
  const form = must(/(@[a-z0-9-]+) \w+ "Form"/.exec(home)?.[1], 'the ref of Form');
  for (const r of [
    await call('tap', { ref: form, read: 'none' }),
    await call('steps', { steps: [{ action: 'press_key', key: 'back' }], read: 'none' }),
  ]) {
    expect(r.structuredContent?.text).toBe(r.content.map((c) => c.text).join('\n'));
    expect(r.structuredContent).not.toHaveProperty('done');
  }
});
