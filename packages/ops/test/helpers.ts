import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '@appdyno/mcp';
import { opsFor, ServerContext, type Op } from '../src/index.js';

/** Calls operations as their tools do: through their input schema, with their text and data back. */
export const callerOf = (ctx: ServerContext) => {
  const ops = opsFor(ctx);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const op = ops[name] as Op;
    const r = await op.handler(op.input.parse(args) as Record<string, unknown>);
    return {
      text: r.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n'),
      data: r.data,
    };
  };
};

/** A client of this context's server, in this process. */
export async function linkedClient(
  ctx: ServerContext,
  log: Parameters<typeof createServer>[1] = () => undefined,
) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(opsFor(ctx), log).connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  return client;
}
