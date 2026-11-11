import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must, type DeviceProvider } from '@appdyno/core';
import { ServerContext } from '../../src/context.js';
import { DEFAULT_POLICY, type Policy } from '../../src/policy.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { linkedClient, type Revision } from '@appdyno/testing/calls.js';

export type Result = {
  isError?: boolean;
  content: { type: string; text?: string; data?: string }[];
  structuredContent?: Record<string, unknown>;
};

export const MEASUREMENTS = mkdtempSync(join(tmpdir(), 'appdyno-measure-'));

export async function connect(
  policy: Partial<Policy> = {},
  device: FakeDevice = new FakeDevice(),
  others: Awaited<ReturnType<DeviceProvider['list']>> = [],
  revision?: Revision,
) {
  const logs: object[] = [];
  const provider: DeviceProvider = {
    list: () =>
      Promise.resolve([
        { serial: device.serial, state: 'device', ready: true, model: 'Fake' },
        ...others,
      ]),
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext({ ...DEFAULT_POLICY, ...policy }, [provider], {
    app: 'dev.app',
    storage: { measurements: MEASUREMENTS },
  });
  const client = await linkedClient(ctx, (l) => logs.push(l), undefined, revision);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as Result;
  const textOf = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(name, args);
    return { error: r.isError === true, text: r.content.map((c) => c.text ?? '').join('\n') };
  };
  return { client, call, textOf, device, logs };
}

export const refOf = (screen: string, label: string) =>
  must(new RegExp(`(@[a-z0-9-]+) \\w+ "${label}"`).exec(screen)?.[1], `the ref of ${label}`);
