import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElicitResult } from '@modelcontextprotocol/client';
import type { Tree } from '@appdyno/protocol';
import { DEFAULT_POLICY, ServerContext, type Policy } from '../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { linkedClient } from '@appdyno/testing/calls.js';

/** A screen read from an emulator or simulator of ours, with the dialog open and dismissed after, never confirmed. */
export const recorded = (name: string) =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures/power', `${name}.json`), 'utf8'),
  ) as Tree;

/** The middle of the node whose words are `label`, as a touch by x,y aims. */
export function middle(tree: Tree, label: string) {
  const n = tree.nodes.find((x) => x.t === label || x.d === label);
  if (!n) throw new Error(`no ${label}`);
  return { x: (n.b[0] + n.b[2]) / 2, y: (n.b[1] + n.b[3]) / 2 };
}

/** A device showing `screen`; a client that answers each question as `answer` says, or cannot ask. */
export async function onDevice(
  screen: string | Tree,
  o: { virtual?: boolean; policy?: Partial<Policy>; answer?: ElicitResult['action'] } = {},
) {
  const asked: string[] = [];
  const device = Object.assign(new FakeDevice(), {
    virtual: o.virtual ?? true,
    fixture: typeof screen === 'string' ? recorded(screen) : screen,
  });
  const ctx = new ServerContext(
    { ...DEFAULT_POLICY, ...o.policy },
    [
      {
        list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
        handles: () => true,
        open: () => device,
      },
    ],
    { app: 'dev.app' },
  );
  const answer = o.answer;
  const client = await linkedClient(ctx, undefined, answer && ((q) => (asked.push(q), answer)));
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { text?: string }[];
      structuredContent?: { code?: string; hint?: string };
    };
    return {
      error: r.isError === true,
      text: r.content.map((c) => c.text).join('\n'),
      ...r.structuredContent,
    };
  };
  /** What reached the device: its touches and keys. */
  const sent = () =>
    device.calls.filter((c) => c.name === 'act' || c.name === 'typeText').map((c) => c.args[0]);
  return { call, asked, sent, device, tree: device.fixture };
}
