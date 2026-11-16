import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iosScreen } from '@appdyno/driver-apple';
import type { ActParams, Tree } from '@appdyno/protocol';
import { linkedClient } from '@appdyno/testing/calls.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { DEFAULT_POLICY, ServerContext } from '../../src/index.js';

/** A screen read on a simulator or an emulator of ours, kept among the packages' test fixtures. */
export const recorded = (path: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '../../..', path), 'utf8')) as Tree;

/** A device that shows recorded screens: `onAct` changes what it shows, as the app would under that action. */
export class Scripted extends FakeDevice {
  onAct: (action: ActParams) => void = () => undefined;
  override act(action: ActParams, opts: Parameters<FakeDevice['act']>[1] = {}) {
    this.onAct(action);
    return super.act(action, opts);
  }
}

/** The same, as an iPhone 17 simulator: the recorded iOS screens are read as its platform reads them. */
export function simulator(fixture: Tree) {
  const d = Object.assign(new Scripted('DC5E9228-0F8D-44E1-9657-97880485E857'), { fixture });
  Object.defineProperty(d, 'platform', { value: 'ios' });
  Object.defineProperty(d, 'platformScreen', { value: iosScreen });
  d.hello = {
    ...d.hello,
    platform: 'ios',
    osVersion: '27.2',
    model: 'iPhone 17',
    screen: { w: 402, h: 874, density: 3, rotation: 0 },
  };
  delete d.hello.sdk;
  return d;
}

/** One call as a client gets it: its text, and the characters of that and of its structured content. */
export type Call = {
  tool: string;
  said: string;
  text: number;
  structured: number;
  refused: boolean;
};

type Result = {
  isError?: boolean;
  content: { text?: string }[];
  structuredContent?: { hint?: string };
};

/** A client of a server on `device`, in this process, that keeps the size of every answer. */
export async function clientOf(device: FakeDevice, app = 'dev.app') {
  const ctx = new ServerContext(
    DEFAULT_POLICY,
    [
      {
        list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
        handles: () => true,
        open: () => device,
      },
    ],
    { app, storage: { measurements: mkdtempSync(join(tmpdir(), 'appdyno-efficiency-')) } },
  );
  const client = await linkedClient(ctx);
  const calls: Call[] = [];
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name: tool, arguments: args })) as Result;
    const text = r.content.map((c) => c.text ?? '').join('\n');
    const refused = r.isError === true;
    calls.push({
      tool,
      said: text,
      text: text.length,
      structured: JSON.stringify(r.structuredContent ?? {}).length,
      refused,
    });
    return { text, refused, hint: r.structuredContent?.hint ?? '' };
  };
  return { call, calls, client };
}
