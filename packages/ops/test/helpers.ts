import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '@appdyno/mcp';
import { opsFor, ServerContext, type Op, type OpData, type OpName } from '../src/index.js';

/** The operations, each held to its output schema: what it answers must be all that says, and no more. */
export const checkedOps = (ctx: ServerContext): Record<string, Op> =>
  Object.fromEntries(
    Object.entries(opsFor(ctx)).map(([name, op]) => [
      name,
      {
        ...op,
        handler: async (args) => {
          const r = await op.handler(args);
          op.output.strict().parse(r.data);
          return r;
        },
      },
    ]),
  );

/** Calls operations as their tools do: through their input schema, with their text and data back. */
export const callerOf = (ctx: ServerContext) => {
  const ops = checkedOps(ctx);
  return async <N extends OpName>(name: N, args: Record<string, unknown> = {}) => {
    const op = ops[name] as Op;
    const r = await op.handler(op.input.parse(args) as Record<string, unknown>);
    return {
      text: r.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n'),
      data: r.data as OpData<N>,
    };
  };
};

/** A client of this context's server, in this process. */
export async function linkedClient(
  ctx: ServerContext,
  log: Parameters<typeof createServer>[1] = () => undefined,
) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(checkedOps(ctx), log).connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  return client;
}
