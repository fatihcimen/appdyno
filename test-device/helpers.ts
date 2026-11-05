import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appleProvider, Devicectl } from 'appdyno';
import type { DeviceProvider } from '@appdyno/core';
import {
  DEFAULT_POLICY,
  ServerContext,
  ToolError,
  type Op,
  type OpData,
  type OpName,
} from '@appdyno/ops';
import { checkedOps } from '../packages/ops/test/helpers.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

/** What a client sees: the op's data, or with `error` its refusal's code. */
export type Answer<D = unknown> = { error: boolean; text: string; data: D & { code?: string } };

export type Call = <N extends OpName>(
  name: N,
  args?: Record<string, unknown>,
) => Promise<Answer<OpData<N>>>;

/** Calls an operation as a client sees it: through its input schema, a refusal as an answer. */
export const opCaller =
  (ops: Record<string, Op>): Call =>
  async <N extends OpName>(
    name: N,
    args: Record<string, unknown> = {},
  ): Promise<Answer<OpData<N>>> => {
    const op = ops[name] as Op;
    try {
      const r = await op.handler(op.input.parse(args) as Record<string, unknown>);
      return {
        error: false,
        text: r.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n'),
        data: r.data as OpData<N> & { code?: string },
      };
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      return {
        error: true,
        text: e.message,
        data: { code: e.code } as OpData<N> & { code?: string },
      };
    }
  };

/** The operations on one device with stores of their own, as a client calls them. */
export function opsOn(provider: DeviceProvider, device: string, app: string) {
  const measurements = mkdtempSync(join(tmpdir(), 'appdyno-measures-'));
  const perf = mkdtempSync(join(tmpdir(), 'appdyno-perf-'));
  const ctx = new ServerContext(DEFAULT_POLICY, [provider], { device, app, measurements, perf });
  return { ctx, measurements, call: opCaller(checkedOps(ctx)) };
}

/** A fixture signed for the iPhone APPDYNO_IPHONE_UDID names. */
export const IPHONE_FIXTURE = process.env.APPDYNO_IPHONE_FIXTURE_APP;
export const IPHONE = IPHONE_FIXTURE && process.env.APPDYNO_IPHONE_UDID;

/** The operations on that iPhone, with the fixture on it. */
export async function onIphone(app: string) {
  await new Devicectl(IPHONE!).install(IPHONE_FIXTURE!);
  return opsOn(appleProvider(), IPHONE!, app);
}

/** Calls a tool over the client `get` gives, which connects after this is made. */
export const toolCaller =
  (get: () => Client) =>
  async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await get().callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text?: string }[];
    };
    return {
      error: r.isError === true,
      text: r.content.map((c) => c.text ?? '').join('\n'),
      content: r.content,
    };
  };

/** The ref a screen's text gives the element with this label. */
export const refIn = (text: string, label: string) =>
  new RegExp(`(@[a-z0-9-]+) (?:\\w+ )?"${label}"`).exec(text)?.[1];
