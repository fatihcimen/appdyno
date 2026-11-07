import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from '@appdyno/mcp';
import { latestRuns, runKeys } from '@appdyno/perf';
import {
  DEFAULT_POLICY,
  opsFor,
  ServerContext,
  type Op,
  type OpData,
  type OpName,
} from '../src/index.js';
import { FakeDevice } from './fake-device.js';

/** The operations, each held to its output schema: an answer must be what that says, no more and no less. */
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

/** One tool on a phone that answers `measures`: its answer, and what was kept of it, none if nothing was. */
export async function keptBy(
  tool: OpName,
  args: Record<string, unknown>,
  measures: Record<string, unknown>,
): Promise<{
  lines: string[];
  data: Record<string, unknown>;
  kept: { kind: string; value: number; source: string }[];
}> {
  const device = new FakeDevice();
  device.virtual = false;
  Object.defineProperty(device, 'measure', {
    value: { ...device.measure, ...measures },
  });
  const measurements = mkdtempSync(join(tmpdir(), 'appdyno-kept-'));
  const ctx = new ServerContext(
    DEFAULT_POLICY,
    [
      {
        list: async () => [{ serial: device.serial, state: 'device', ready: true }],
        handles: () => true,
        open: () => device,
      },
    ],
    { device: device.serial, app: 'dev.app', measurements, perf: measurements },
  );
  const { text, data } = await callerOf(ctx)(tool, args);
  const [key] = await runKeys(measurements, { app: 'dev.app' });
  const run = key ? (await latestRuns(measurements, key, 1))[0]! : [];
  return {
    lines: text.split('\n'),
    data: data as Record<string, unknown>,
    kept: run.map(({ kind, value, source }) => ({ kind, value, source })),
  };
}

/** A client of this context's server, in this process; with `answer`, one that shows the server's questions to a person. */
export async function linkedClient(
  ctx: ServerContext,
  log: Parameters<typeof createServer>[1] = () => undefined,
  answer?: (question: string) => ElicitResult['action'],
) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(checkedOps(ctx), log).connect(a);
  const client = new Client(
    { name: 'test', version: '0' },
    answer && { capabilities: { elicitation: {} } },
  );
  if (answer)
    client.setRequestHandler(ElicitRequestSchema, (r) => ({ action: answer(r.params.message) }));
  await client.connect(b);
  return client;
}
