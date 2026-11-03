import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceProvider } from '@appdyno/core';
import { DEFAULT_POLICY, opsFor, ServerContext, ToolError, type Op } from '@appdyno/ops';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

export type Answer = { error: boolean; text: string; data: Record<string, unknown> };

/** Calls an operation as a client sees it: through its input schema, a refusal as an answer. */
export const opCaller =
  (ops: Record<string, Op>) =>
  async (name: string, args: Record<string, unknown> = {}): Promise<Answer> => {
    const op = ops[name] as Op;
    try {
      const r = await op.handler(op.input.parse(args) as Record<string, unknown>);
      return {
        error: false,
        text: r.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n'),
        data: r.data,
      };
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      return { error: true, text: e.message, data: { code: e.code } };
    }
  };

/** The operations on one device with stores of their own, as a client calls them. */
export function opsOn(provider: DeviceProvider, device: string, app: string) {
  const measurements = mkdtempSync(join(tmpdir(), 'appdyno-measures-'));
  const perf = mkdtempSync(join(tmpdir(), 'appdyno-perf-'));
  const ctx = new ServerContext(DEFAULT_POLICY, [provider], { device, app, measurements, perf });
  return { ctx, measurements, call: opCaller(opsFor(ctx)) };
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
