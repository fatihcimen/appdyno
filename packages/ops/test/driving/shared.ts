import { must, type Device, type DeviceProvider, type VirtualDevices } from '@appdyno/core';
import { type ActParams, type ErrorCode, type Tree } from '@appdyno/protocol';
import {
  DEFAULT_POLICY,
  ServerContext,
  type OpData,
  type OpName,
  type Policy,
} from '../../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { SCREENS } from '@appdyno/testing/fake-screens.js';
import { linkedClient } from '@appdyno/testing/calls.js';

export type Result = {
  isError?: boolean;
  content: { type?: string; text?: string }[];
  structuredContent?: unknown;
};

/** What a tool answered, as this server writes it: its output, or a refusal's code and hint; any of it may be missing. */
export type Answer<N extends OpName> = Partial<OpData<N>> & {
  code?: ErrorCode;
  hint?: string;
  dispatched?: boolean | 'unknown';
};

export async function connect(
  device: Device,
  o: {
    policy?: Partial<Policy>;
    virtual?: VirtualDevices;
    defaults?: ConstructorParameters<typeof ServerContext>[2];
  } = {},
) {
  const provider: DeviceProvider = {
    list: () =>
      Promise.resolve([{ serial: device.serial, state: 'device', ready: true, model: 'Fake' }]),
    handles: () => true,
    open: () => device,
    ...(o.virtual && { virtual: o.virtual }),
  };
  const ctx = new ServerContext({ ...DEFAULT_POLICY, ...o.policy }, [provider], {
    app: 'dev.app',
    ...o.defaults,
  });
  const client = await linkedClient(ctx);
  const call = async <N extends OpName>(name: N, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as Result;
    return {
      error: r.isError === true,
      text: r.content.map((c) => c.text ?? '').join('\n'),
      data: r.structuredContent as Answer<N>,
      images: r.content.filter((c) => c.type === 'image').length,
    };
  };
  return { call, ctx };
}

export const act = (d: FakeDevice) =>
  d.calls.filter((c) => c.name === 'act').map((c) => c.args[0] as ActParams);

/** Adds screens to the fake's list for a test. */
export function withScreen(name: string, nodes: (typeof SCREENS)[string]) {
  SCREENS[name] = nodes;
}

/** A list of 30 rows: a swipe up moves it by the finger's way, down to its end. */
export class ScrollingList extends FakeDevice {
  offset = 0;
  swipes = 0;
  /** What the list takes of a finger's way. */
  taken(by: number) {
    return by;
  }
  override current(): Tree {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      t: `Row ${i}`,
      b: [0, 200 * i - this.offset, 1080, 200 * i - this.offset + 180] as [
        number,
        number,
        number,
        number,
      ],
    })).filter((r) => r.b[3] > 0 && r.b[1] < 2400);
    SCREENS.scroll = rows;
    this.screen = 'scroll';
    return super.current();
  }
  override async act(action: ActParams, opts = {}) {
    if (action.kind === 'gesture') {
      this.swipes++;
      const p = must(action.pointers[0], 'a path');
      const by = this.taken(must(p[0], 'its start').y - must(p.at(-1), 'its end').y);
      this.offset = Math.min(Math.max(this.offset + by, 0), 200 * 30 - 2400);
    }
    return super.act(action, opts);
  }
}
