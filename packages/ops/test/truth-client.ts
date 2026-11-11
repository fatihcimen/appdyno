import type { Device, DeviceProvider } from '@appdyno/core';
import { ServerContext } from '../src/context.js';
import { DEFAULT_POLICY, type Policy } from '../src/policy.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { linkedClient } from '@appdyno/testing/calls.js';
import { onFakeTime } from '@appdyno/testing/fake-time.js';

type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
};

/** A client of a context on one device, each call on fake time, its text joined. */
export async function connect(device: Device = new FakeDevice(), policy: Partial<Policy> = {}) {
  const provider: DeviceProvider = {
    list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext({ ...DEFAULT_POLICY, ...policy }, [provider], { app: 'dev.app' });
  const client = await linkedClient(ctx);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await onFakeTime(client.callTool({ name, arguments: args }))) as Result;
    return { ...r, text: r.content.map((c) => c.text ?? '').join('\n') };
  };
  return { client, call, ctx };
}
